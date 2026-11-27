import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Importar from './Importar'
const R = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const num = (s) => { s = String(s).trim(); return parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) }
const hoje = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}` }
const TIPOS = { conta: 'Conta corrente', poupanca: 'Poupança', dinheiro: 'Dinheiro em espécie' }
const br = (d) => d.split('-').reverse().join('/')

export function saldos(contas, transf, tx) {
  const o = {}
  contas.forEach((c) => { o[c.id] = Number(c.initial_balance) })
  transf.forEach((t) => {
    if (o[t.from_account] !== undefined) o[t.from_account] -= Number(t.amount)
    if (o[t.to_account] !== undefined) o[t.to_account] += Number(t.amount)
  })
  tx.filter((x) => x.paid && x.account_id && o[x.account_id] !== undefined).forEach((x) => {
    o[x.account_id] += x.kind === 'receita' ? Number(x.amount) : -Number(x.amount)
  })
  return o
}

export function SeletorConta({ value, onChange, rotulo }) {
  const [contas, setContas] = useState([])
  useEffect(() => {
    supabase.from('accounts').select('id,name').order('name').then(({ data }) => setContas(data || []))
  }, [])
  if (!contas.length) return null
  return (
    <>
      <label>{rotulo || 'Conta'}</label>
      <select value={value || ''} onChange={onChange}>
        <option value="">Sem conta</option>
        {contas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </>
  )
}

export function SaldoTotal({ tx }) {
  const [contas, setContas] = useState([])
  const [transf, setTransf] = useState([])
  useEffect(() => {
    (async () => {
      const [a, b] = await Promise.all([
        supabase.from('accounts').select('*').order('name'),
        supabase.from('transfers').select('*'),
      ])
      setContas(a.data || [])
      setTransf(b.data || [])
    })()
  }, [])
  if (!contas.length) return null
  const s = saldos(contas, transf, tx)
  const total = Object.values(s).reduce((a, b) => a + b, 0)
  return (
    <section className="card">
      <div className="lbl">Saldo total disponível</div>
      <div className={'big' + (total < 0 ? ' neg' : '')}>{R(total)}</div>
      {contas.map((c) => (
        <div className="ln" key={c.id}><span>{c.name}</span><b className={s[c.id] < 0 ? 'neg' : ''}>{R(s[c.id])}</b></div>
      ))}
    </section>
  )
}

export default function Bancos() {
  const [contas, setContas] = useState([])
  const [transf, setTransf] = useState([])
  const [tx, setTx] = useState([])
  const [msg, setMsg] = useState('')
  const [novaConta, setNovaConta] = useState(false)
  const [fc, setFc] = useState({ name: '', kind: 'conta', saldo: '' })
  const [ft, setFt] = useState({ de: '', para: '', valor: '', data: hoje(), nota: '' })

  async function carregar() {
    const [a, b, c] = await Promise.all([
      supabase.from('accounts').select('*').order('name'),
      supabase.from('transfers').select('*').order('tdate', { ascending: false }),
      supabase.from('transactions').select('*').eq('paid', true),
    ])
    if (a.error || b.error || c.error) setMsg((a.error || b.error || c.error).message)
    setContas(a.data || [])
    setTransf(b.data || [])
    setTx(c.data || [])
  }
  useEffect(() => { carregar() }, [])

  async function addConta(e) {
    e.preventDefault()
    if (!fc.name.trim()) return setMsg('Dê um nome para a conta.')
    const saldo = num(fc.saldo)
    const { error } = await supabase.from('accounts').insert({
      name: fc.name.trim(), kind: fc.kind, initial_balance: isNaN(saldo) ? 0 : saldo,
    })
    if (error) return setMsg(error.message)
    setFc({ name: '', kind: 'conta', saldo: '' })
    setNovaConta(false)
    carregar()
  }

  async function excluirConta(c) {
    await supabase.from('accounts').delete().eq('id', c.id)
    carregar()
  }

  async function transferir(e) {
    e.preventDefault()
    const de = ft.de || (contas[0] && contas[0].id)
    const para = ft.para || (contas[1] && contas[1].id)
    const v = num(ft.valor)
    if (!de || !para || de === para) return setMsg('Escolha duas contas diferentes.')
    if (!(v > 0)) return setMsg('Informe o valor da transferência.')
    const { error } = await supabase.from('transfers').insert({
      from_account: de, to_account: para, amount: v, tdate: ft.data, note: ft.nota,
    })
    if (error) return setMsg(error.message)
    setFt({ de: '', para: '', valor: '', data: hoje(), nota: '' })
    setMsg('Transferência registrada.')
    carregar()
  }

  async function excluirTransf(t) {
    await supabase.from('transfers').delete().eq('id', t.id)
    carregar()
  }

  const s = saldos(contas, transf, tx)
  const total = Object.values(s).reduce((a, b) => a + b, 0)
  const nome = (id) => (contas.find((c) => c.id === id) || {}).name || 'Conta removida'

  return (
    <>
      {msg && <div className="msg" onClick={() => setMsg('')}>{msg}</div>}
      <section className="card">
        <div className="lbl">Saldo total disponível</div>
        <div className={'big' + (total < 0 ? ' neg' : '')}>{R(total)}</div>
        <small>Soma de todas as contas, com transferências e lançamentos pagos.</small>
      </section>
<Importar contas={contas} onDone={carregar} />
      <h3 style={{ margin: '6px 0 10px' }}>Minhas contas</h3>
      {contas.length === 0 && <p className="empty">Nenhuma conta cadastrada.</p>}
      {contas.map((c) => (
        <div className="card" key={c.id}>
          <div className="ln" style={{ marginTop: 0 }}>
            <span><b>{c.name}</b><small> {TIPOS[c.kind] || ''}</small></span>
            <b className={s[c.id] < 0 ? 'neg' : 'pos'}>{R(s[c.id])}</b>
          </div>
          <div className="act" style={{ marginTop: 8 }}>
            <button onClick={() => excluirConta(c)}>Excluir conta</button>
          </div>
        </div>
      ))}

      {novaConta ? (
        <form className="card" onSubmit={addConta}>
          <label>Nome da conta</label>
          <input value={fc.name} onChange={(e) => setFc({ ...fc, name: e.target.value })} placeholder="Ex.: Nubank, Itaú, Carteira" />
          <label>Tipo</label>
          <select value={fc.kind} onChange={(e) => setFc({ ...fc, kind: e.target.value })}>
            {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
          <label>Saldo de hoje (R$)</label>
          <input inputMode="decimal" value={fc.saldo} onChange={(e) => setFc({ ...fc, saldo: e.target.value })} />
          <button className="go">Salvar conta</button>
        </form>
      ) : (
        <button className="go" onClick={() => setNovaConta(true)}>Adicionar conta</button>
      )}

      {contas.length >= 2 && (
        <>
          <h3 style={{ margin: '22px 0 10px' }}>Transferir entre contas</h3>
          <form className="card" onSubmit={transferir}>
            <div className="g2">
              <div>
                <label>De</label>
                <select value={ft.de || contas[0].id} onChange={(e) => setFt({ ...ft, de: e.target.value })}>
                  {contas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label>Para</label>
                <select value={ft.para || contas[1].id} onChange={(e) => setFt({ ...ft, para: e.target.value })}>
                  {contas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="g2">
              <div><label>Valor (R$)</label><input inputMode="decimal" value={ft.valor} onChange={(e) => setFt({ ...ft, valor: e.target.value })} /></div>
              <div><label>Data</label><input type="date" value={ft.data} onChange={(e) => setFt({ ...ft, data: e.target.value })} /></div>
            </div>
            <label>Observação</label>
            <input value={ft.nota} onChange={(e) => setFt({ ...ft, nota: e.target.value })} />
            <button className="go">Transferir</button>
          </form>
        </>
      )}

      {transf.length > 0 && (
        <>
          <h3 style={{ margin: '22px 0 10px' }}>Últimas transferências</h3>
          {transf.slice(0, 10).map((t) => (
            <div className="row" key={t.id}>
              <div />
              <div className="inf">
                <b>{nome(t.from_account)} → {nome(t.to_account)}</b>
                <small>{br(t.tdate)}{t.note ? ', ' + t.note : ''}</small>
              </div>
              <div className="val">{R(t.amount)}</div>
              <div className="act"><button onClick={() => excluirTransf(t)}>Excluir</button></div>
            </div>
          ))}
        </>
      )}
    </>
  )
}
