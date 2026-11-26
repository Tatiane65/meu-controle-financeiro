import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './orcamento.css'

const R = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ymOf = (d) => { const p = d.split('-'); return Number(p[0]) * 12 + Number(p[1]) - 1 }
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const rotulo = (t) => `${MESES[t % 12]} ${Math.floor(t / 12)}`
const CATS = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Compras', 'Financiamentos', 'Empréstimos', 'Outros']
const num = (s) => { s = String(s).trim(); return parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) }
const isR = (x) => x.kind === 'receita'
const isD = (x) => x.kind === 'despesa'
const soma = (a, f = () => true) => a.filter(f).reduce((s, x) => s + Number(x.amount), 0)
const cor = (p) => (p >= 100 ? '#b3261e' : p >= 90 ? '#d9822b' : p >= 80 ? '#c9a227' : '#0b6e63')
const nivel = (p) => (p >= 100 ? 'estourou' : p >= 90 ? 'passou de 90%' : 'passou de 80%')

function Barra({ p }) {
  return (
    <div className="bar">
      <i style={{ width: Math.min(100, Math.max(0, p)) + '%', background: cor(p) }} />
    </div>
  )
}

export default function Orcamento() {
  const agora = new Date()
  const [tx, setTx] = useState([])
  const [salvos, setSalvos] = useState({})
  const [lim, setLim] = useState({})
  const [uid, setUid] = useState(null)
  const [mes, setMes] = useState(agora.getFullYear() * 12 + agora.getMonth())
  const [msg, setMsg] = useState('')

  async function carregar() {
    const [a, b, u] = await Promise.all([
      supabase.from('transactions').select('*'),
      supabase.from('budgets').select('*'),
      supabase.auth.getUser(),
    ])
    if (a.error || b.error) setMsg((a.error || b.error).message)
    setTx(a.data || [])
    const sv = {}, f = {}
    ;(b.data || []).forEach((r) => {
      sv[r.category] = Number(r.amount)
      f[r.category] = String(r.amount).replace('.', ',')
    })
    setSalvos(sv)
    setLim(f)
    setUid(u.data && u.data.user ? u.data.user.id : null)
  }
  useEffect(() => { carregar() }, [])

  async function salvar(e) {
    e.preventDefault()
    const rows = [], vazias = []
    ;['TOTAL', 'META', ...CATS].forEach((k) => {
      const v = num(lim[k] || '')
      if (v > 0) rows.push({ user_id: uid, category: k, amount: v })
      else vazias.push(k)
    })
    if (rows.length) {
      const { error } = await supabase.from('budgets').upsert(rows, { onConflict: 'user_id,category' })
      if (error) return setMsg(error.message)
    }
    if (vazias.length) await supabase.from('budgets').delete().in('category', vazias)
    setMsg('Orçamento salvo.')
    carregar()
  }

  const doMes = tx.filter((x) => ymOf(x.due_date) === mes)
  const des = soma(doMes, isD)
  const rec = soma(doMes, isR)
  const gasto = {}
  doMes.filter(isD).forEach((x) => { const k = x.category || 'Outros'; gasto[k] = (gasto[k] || 0) + Number(x.amount) })
  const total = salvos.TOTAL || 0
  const meta = salvos.META || 0
  const pTotal = total ? (des / total) * 100 : 0
  const cats = CATS.filter((c) => salvos[c] > 0)

  const alertas = []
  if (total && pTotal >= 80) alertas.push(`Orçamento do mês: ${nivel(pTotal)} (${pTotal.toFixed(0)}% do limite)`)
  cats.forEach((c) => {
    const p = ((gasto[c] || 0) / salvos[c]) * 100
    if (p >= 80) alertas.push(`${c}: ${nivel(p)} (${p.toFixed(0)}% do limite)`)
  })

  let acc = 0
  const proj = [0, 1, 2, 3, 4, 5].map((i) => {
    const m = mes + i
    const b = tx.filter((x) => ymOf(x.due_date) === m)
    const r = soma(b, isR), d = soma(b, isD)
    acc += r - d
    return { m, r, d, s: r - d, acc }
  })

  const saldoMes = rec - des
  const pMeta = meta ? (Math.max(0, saldoMes) / meta) * 100 : 0
  const temAlgum = Object.keys(salvos).length > 0
  const setL = (k) => (e) => setLim({ ...lim, [k]: e.target.value })

  return (
    <>
      {msg && <div className="msg" onClick={() => setMsg('')}>{msg}</div>}
      <div className="mn">
        <button onClick={() => setMes(mes - 1)} aria-label="Mês anterior">‹</button>
        <b>{rotulo(mes)}</b>
        <button onClick={() => setMes(mes + 1)} aria-label="Próximo mês">›</button>
      </div>

      {alertas.length > 0 && (
        <div className="alerta">
          {alertas.map((a) => <p key={a}>⚠ {a}</p>)}
        </div>
      )}

      <section className="card">
        <div className="lbl">Orçamento do mês</div>
        {total ? (
          <>
            <div className={'big' + (des > total ? ' neg' : '')}>
              {des > total ? 'Passou ' + R(des - total) : 'Ainda posso gastar ' + R(total - des)}
            </div>
            <Barra p={pTotal} />
            <small>Gasto {R(des)} de {R(total)} ({pTotal.toFixed(0)}%)</small>
          </>
        ) : (
          <small>Defina o orçamento do mês em "Definir orçamento e metas", logo abaixo.</small>
        )}
      </section>

      {cats.length > 0 && (
        <section className="card">
          <h3 style={{ margin: '0 0 4px' }}>Limites por categoria</h3>
          {cats.map((c) => {
            const g = gasto[c] || 0
            const p = (g / salvos[c]) * 100
            return (
              <div key={c}>
                <div className="ln"><span>{c}</span><b>{R(g)} <small>de {R(salvos[c])} ({p.toFixed(0)}%)</small></b></div>
                <Barra p={p} />
              </div>
            )
          })}
        </section>
      )}

      {meta > 0 && (
        <section className="card">
          <h3 style={{ margin: '0 0 4px' }}>Meta de economia</h3>
          <div className="ln">
            <span>Economizado no mês</span>
            <b className={saldoMes < 0 ? 'neg' : ''}>{R(saldoMes)} <small>de {R(meta)}</small></b>
          </div>
          <div className="bar"><i style={{ width: Math.min(100, pMeta) + '%' }} /></div>
          <small>
            {saldoMes >= meta ? 'Meta atingida.' : `Faltam ${R(meta - Math.max(0, saldoMes))} para a meta.`}
          </small>
        </section>
      )}

      <section className="card rel-scroll">
        <h3 style={{ margin: '0 0 6px' }}>Projeção dos próximos 6 meses</h3>
        <table className="tb">
          <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th><th>Acumulado</th></tr></thead>
          <tbody>
            {proj.map((x) => (
              <tr key={x.m}>
                <td>{MESES[x.m % 12].slice(0, 3)}/{String(Math.floor(x.m / 12)).slice(2)}</td>
                <td>{R(x.r)}</td><td>{R(x.d)}</td>
                <td className={x.s < 0 ? 'neg' : ''}>{R(x.s)}</td>
                <td className={x.acc < 0 ? 'neg' : ''}>{R(x.acc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <small>Soma só o que já está lançado: parcelas, contas recorrentes e receitas.</small>
      </section>

      <details open={!temAlgum}>
        <summary>Definir orçamento e metas</summary>
        <form onSubmit={salvar}>
          <label>Orçamento total do mês (R$)</label>
          <input inputMode="decimal" value={lim.TOTAL || ''} onChange={setL('TOTAL')} />
          <label>Meta de economia por mês (R$)</label>
          <input inputMode="decimal" value={lim.META || ''} onChange={setL('META')} />
          <label style={{ marginTop: 16, fontWeight: 700, color: '#12302b' }}>Limite por categoria (R$)</label>
          <div className="g2">
            {CATS.map((c) => (
              <div key={c}>
                <label>{c}</label>
                <input inputMode="decimal" value={lim[c] || ''} onChange={setL(c)} />
              </div>
            ))}
          </div>
          <small>Deixe em branco o que não quiser controlar.</small>
          <button className="go">Salvar orçamento</button>
        </form>
      </details>
    </>
  )
}
