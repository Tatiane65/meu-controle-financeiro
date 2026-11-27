import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const R = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pad = (n) => String(n).padStart(2, '0')
const CATS = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Compras', 'Financiamentos', 'Empréstimos', 'Outros']
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

function parseData(s) {
  s = String(s || '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (m) {
    let y = m[3]
    if (y.length === 2) y = '20' + y
    return `${y}-${pad(m[2])}-${pad(m[1])}`
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

function parseValor(s) {
  s = String(s || '').replace(/[^\d,.\-+]/g, '')
  if (!s) return NaN
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  return parseFloat(s)
}

function parseCSV(t) {
  const first = t.split(/\r?\n/)[0] || ''
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]
  const rows = []
  let row = [], cur = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else cur += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cur); cur = ''; rows.push(row); row = []
    } else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function lerOFX(t) {
  const out = []
  t.split(/<STMTTRN>/i).slice(1).forEach((b) => {
    const g = (tag) => { const m = b.match(new RegExp('<' + tag + '>\\s*([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : '' }
    const data = parseData(g('DTPOSTED'))
    const v = parseValor(g('TRNAMT'))
    const desc = (g('MEMO') || g('NAME')).replace(/&amp;/g, '&')
    if (data && !isNaN(v) && v !== 0) out.push({ date: data, desc, v })
  })
  return out
}

function lerCSV(t) {
  const rows = parseCSV(t)
  const h = rows.findIndex((r) => {
    const c = r.map(norm)
    return c.some((x) => x.includes('data') || x.startsWith('date')) &&
      c.some((x) => x.includes('valor') || x.startsWith('amount') || x.startsWith('value') || x.includes('credito') || x.includes('debito'))
  })
  if (h < 0) return null
  const hd = rows[h].map(norm)
  const iDate = hd.findIndex((x) => x.includes('data') || x.startsWith('date'))
  const iVal = hd.findIndex((x) => x.includes('valor') || x.startsWith('amount') || x.startsWith('value'))
  const iCre = hd.findIndex((x) => x.includes('credito'))
  const iDeb = hd.findIndex((x) => x.includes('debito'))
  let iDesc = hd.findIndex((x) => /descri|histor|memo|lancamento|estabelec|title|nome/.test(x))
  if (iDesc < 0) iDesc = hd.findIndex((x, i) => i !== iDate && i !== iVal && i !== iCre && i !== iDeb)
  const out = []
  rows.slice(h + 1).forEach((r) => {
    const data = parseData(r[iDate])
    let v
    if (iVal >= 0) v = parseValor(r[iVal])
    else {
      const cr = parseValor(r[iCre]), de = parseValor(r[iDeb])
      v = (isNaN(cr) ? 0 : cr) - (isNaN(de) ? 0 : Math.abs(de))
    }
    if (data && !isNaN(v) && v !== 0) out.push({ date: data, desc: String(r[iDesc] || '').trim(), v })
  })
  return out
}

async function decodificar(file) {
  const buf = await file.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) }
  catch (e) { return new TextDecoder('windows-1252').decode(buf) }
}

export default function Importar({ contas, onDone }) {
  const [bruto, setBruto] = useState([])
  const [arq, setArq] = useState('')
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [inv, setInv] = useState(false)
  const [conta, setConta] = useState('')
  const [pago, setPago] = useState(true)
  const [cat, setCat] = useState('Outros')
  const [manual, setManual] = useState({})
  const [existentes, setExistentes] = useState(new Set())
  const [busy, setBusy] = useState(false)

  async function carregarExist() {
    const { data } = await supabase.from('transactions').select('due_date,amount,kind')
    setExistentes(new Set((data || []).map((x) => `${x.due_date}|${x.kind}|${Number(x.amount).toFixed(2)}`)))
  }
  useEffect(() => { carregarExist() }, [])

  async function ler(e) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setErro(''); setOk(''); setManual({}); setBruto([]); setArq(f.name)
    try {
      const t = await decodificar(f)
      const itens = /<STMTTRN>/i.test(t) ? lerOFX(t) : lerCSV(t)
      if (itens === null) return setErro('Não identifiquei as colunas. O CSV precisa ter colunas de data e valor, e de preferência uma de descrição.')
      if (!itens.length) return setErro('Não encontrei lançamentos neste arquivo.')
      setBruto(itens)
    } catch (err) {
      setErro('Não consegui ler o arquivo.')
    }
  }

  const lista = bruto.map((x) => {
    const v = inv ? -x.v : x.v
    const tipo = v < 0 ? 'despesa' : 'receita'
    const amount = Math.abs(v)
    return { ...x, tipo, amount, dup: existentes.has(`${x.date}|${tipo}|${amount.toFixed(2)}`) }
  })
  const marcado = (i) => (manual[i] !== undefined ? manual[i] : !lista[i].dup)
  const esc = lista.filter((_, i) => marcado(i))
  const dups = lista.filter((x) => x.dup).length
  const totR = esc.filter((x) => x.tipo === 'receita').reduce((s, x) => s + x.amount, 0)
  const totD = esc.filter((x) => x.tipo === 'despesa').reduce((s, x) => s + x.amount, 0)

  async function importar() {
    if (!esc.length) return setErro('Nenhum lançamento selecionado.')
    setBusy(true); setErro('')
    const rows = esc.map((x) => ({
      description: (x.desc || 'Sem descrição').slice(0, 200),
      category: x.tipo === 'receita' ? 'Receita' : cat,
      kind: x.tipo,
      amount: x.amount,
      due_date: x.date,
      paid: pago,
      pay_method: 'Extrato',
      account_id: conta || null,
      recurrence: 'unica',
    }))
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('transactions').insert(rows.slice(i, i + 200))
      if (error) { setBusy(false); return setErro(error.message) }
    }
    setBusy(false); setBruto([]); setArq(''); setManual({})
    setOk(`${rows.length} lançamentos importados.`)
    carregarExist()
    if (onDone) onDone()
  }

  return (
    <details>
      <summary>Importar extrato (CSV ou OFX)</summary>
      <label>Arquivo do banco</label>
      <input type="file" accept=".csv,.ofx,.txt,text/csv" onChange={ler} />
      {arq && <small>{arq}</small>}
      {erro && <p style={{ color: '#b3261e' }}>{erro}</p>}
      {ok && <p style={{ color: '#0b6e63' }}>{ok}</p>}

      {bruto.length > 0 && (
        <>
          <p>
            <b>{lista.length}</b> lançamentos encontrados, <b>{dups}</b> possíveis duplicados (já vêm desmarcados).
          </p>
          <label className="ck">
            <input type="checkbox" checked={inv} onChange={(e) => { setInv(e.target.checked); setManual({}) }} />
            Valores positivos são despesas (comum em fatura de cartão)
          </label>
          <label>Categoria das despesas importadas</label>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
          <label>Conta</label>
          <select value={conta} onChange={(e) => setConta(e.target.value)}>
            <option value="">Sem conta (não altera o saldo)</option>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="ck">
            <input type="checkbox" checked={pago} onChange={(e) => setPago(e.target.checked)} />
            Marcar como pagos
          </label>
          <small>Se o saldo de hoje que você informou na conta já inclui esses lançamentos, deixe "Sem conta".</small>

          <p>Selecionados: {esc.length}. Receitas {R(totR)}, despesas {R(totD)}.</p>
          {lista.slice(0, 300).map((x, i) => (
            <div className="row" key={i}>
              <input type="checkbox" checked={marcado(i)} onChange={(e) => setManual({ ...manual, [i]: e.target.checked })} />
              <div className="inf">
                <b>{x.desc || 'Sem descrição'}</b>
                <small>{x.date.split('-').reverse().join('/')} {x.dup && <span className="bd">possível duplicado</span>}</small>
              </div>
              <div className={'val ' + (x.tipo === 'receita' ? 'pos' : '')}>{x.tipo === 'receita' ? '+' : '-'}{R(x.amount)}</div>
            </div>
          ))}
          {lista.length > 300 && <small>Mostrando os 300 primeiros. Os demais também serão importados se estiverem marcados.</small>}
          <button className="go" onClick={importar} disabled={busy}>{busy ? 'Importando…' : `Importar ${esc.length} lançamentos`}</button>
        </>
      )}
    </details>
  )
}
