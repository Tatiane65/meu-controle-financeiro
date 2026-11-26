import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './calendario.css'

const R = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate()
const hoje = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()) }
const dias = (d) => Math.round((new Date(d + 'T12:00:00') - new Date(hoje() + 'T12:00:00')) / 864e5)
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const SEM = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const isR = (x) => x.kind === 'receita'
const isD = (x) => x.kind === 'despesa'
const status = (x) => (x.paid ? 'paga' : dias(x.due_date) < 0 ? 'vencida' : 'pendente')
const tipoPonto = (x) => (isR(x) ? 'r' : x.paid ? 'p' : status(x) === 'vencida' ? 'v' : x.card_id ? 'c' : 'd')

export default function Calendario() {
  const agora = new Date()
  const [tx, setTx] = useState([])
  const [cards, setCards] = useState([])
  const [mes, setMes] = useState(agora.getFullYear() * 12 + agora.getMonth())
  const [sel, setSel] = useState(hoje())
  const [erro, setErro] = useState('')

  async function carregar() {
    const [a, b] = await Promise.all([
      supabase.from('transactions').select('*').order('due_date'),
      supabase.from('cards').select('*'),
    ])
    if (a.error || b.error) setErro((a.error || b.error).message)
    setTx(a.data || [])
    setCards(b.data || [])
  }
  useEffect(() => { carregar() }, [])

  async function marcar(x) {
    await supabase.from('transactions').update({ paid: !x.paid }).eq('id', x.id)
    carregar()
  }

  function mudar(n) {
    const nm = mes + n
    setMes(nm)
    const y2 = Math.floor(nm / 12), m2 = nm % 12
    const h = hoje()
    setSel(h.startsWith(`${y2}-${pad(m2 + 1)}`) ? h : iso(y2, m2, 1))
  }

  const y = Math.floor(mes / 12), m = mes % 12
  const primeiro = new Date(y, m, 1).getDay()
  const nd = lastDay(y, m)
  const ini = iso(y, m, 1), fim = iso(y, m, nd)
  const doMes = tx.filter((x) => x.due_date >= ini && x.due_date <= fim)
  const porDia = {}
  doMes.forEach((x) => { (porDia[x.due_date] = porDia[x.due_date] || []).push(x) })
  const celulas = []
  for (let i = 0; i < primeiro; i++) celulas.push(null)
  for (let d = 1; d <= nd; d++) celulas.push(d)

  const lista = porDia[sel] || []
  const rDia = lista.filter(isR).reduce((s, x) => s + Number(x.amount), 0)
  const dDia = lista.filter(isD).reduce((s, x) => s + Number(x.amount), 0)
  const dataSel = sel.split('-').reverse().join('/')

  return (
    <>
      {erro && <div className="msg" onClick={() => setErro('')}>{erro}</div>}
      <div className="mn">
        <button onClick={() => mudar(-1)} aria-label="Mês anterior">‹</button>
        <b>{MESES[m]} {y}</b>
        <button onClick={() => mudar(1)} aria-label="Próximo mês">›</button>
      </div>

      <div className="cal">
        {SEM.map((s, i) => <div key={i} className="dow">{s}</div>)}
        {celulas.map((d, i) => {
          if (!d) return <div key={'v' + i} className="vz" />
          const data = iso(y, m, d)
          const pts = [...new Set((porDia[data] || []).map(tipoPonto))]
          return (
            <button
              key={data}
              className={'dia' + (data === sel ? ' sel' : '') + (data === hoje() ? ' hoje' : '')}
              onClick={() => setSel(data)}
            >
              {d}
              <span className="pts">{pts.map((p) => <i key={p} className={'pt ' + p} />)}</span>
            </button>
          )
        })}
      </div>

      <div className="leg">
        <span><i className="pt r" /> Recebimento</span>
        <span><i className="pt d" /> A pagar</span>
        <span><i className="pt c" /> Fatura de cartão</span>
        <span><i className="pt p" /> Paga</span>
        <span><i className="pt v" /> Vencida</span>
      </div>

      <section className="card">
        <h3 style={{ margin: '0 0 6px' }}>{dataSel}</h3>
        {lista.length > 0 && (
          <small>Receitas {R(rDia)}, despesas {R(dDia)}</small>
        )}
      </section>

      {lista.length === 0 && <p className="empty">Nenhum lançamento neste dia.</p>}
      {lista.map((x) => {
        const s = status(x)
        const c = cards.find((k) => k.id === x.card_id)
        return (
          <div key={x.id} className={'row' + (x.paid ? ' ok' : '')}>
            <button className="chk" onClick={() => marcar(x)} aria-label="Marcar como paga">{x.paid ? '✓' : ''}</button>
            <div className="inf">
              <b>{x.description}{x.installments > 1 && <small> {x.installment}/{x.installments}</small>}</b>
              <small>
                {x.category}{c ? ', fatura ' + c.name : x.pay_method ? ', ' + x.pay_method : ''}{' '}
                <span className={'bd ' + s}>{isR(x) && s === 'paga' ? 'recebida' : s}</span>
              </small>
            </div>
            <div className={'val ' + (isR(x) ? 'pos' : '')}>{isR(x) ? '+' : ''}{R(x.amount)}</div>
          </div>
        )
      })}
    </>
  )
}
