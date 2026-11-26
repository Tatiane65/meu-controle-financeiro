import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './relatorios.css'

const R = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const ymOf = (d) => { const p = d.split('-'); return Number(p[0]) * 12 + Number(p[1]) - 1 }
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate()
const mStart = (m) => iso(Math.floor(m / 12), m % 12, 1)
const mEnd = (m) => iso(Math.floor(m / 12), m % 12, lastDay(Math.floor(m / 12), m % 12))
const hoje = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()) }
const dias = (d) => Math.round((new Date(d + 'T12:00:00') - new Date(hoje() + 'T12:00:00')) / 864e5)
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const rotulo = (t) => `${MESES[t % 12]} ${Math.floor(t / 12)}`
const br = (d) => (d ? d.split('-').reverse().join('/') : '')
const isR = (x) => x.kind === 'receita'
const isD = (x) => x.kind === 'despesa'
const soma = (a, f = () => true) => a.filter(f).reduce((s, x) => s + Number(x.amount), 0)
const status = (x) => (x.paid ? 'paga' : dias(x.due_date) < 0 ? 'vencida' : 'pendente')
const pct = (a, b) => (b > 0 ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(0)}%` : '—')

export default function Relatorios() {
  const agora = new Date()
  const [tx, setTx] = useState([])
  const [cards, setCards] = useState([])
  const [tipo, setTipo] = useState('mensal')
  const [mes, setMes] = useState(agora.getFullYear() * 12 + agora.getMonth())
  const [de, setDe] = useState(iso(agora.getFullYear(), agora.getMonth(), 1))
  const [ate, setAte] = useState(hoje())
  const [erro, setErro] = useState('')

  useEffect(() => {
    (async () => {
      const [a, b] = await Promise.all([
        supabase.from('transactions').select('*').order('due_date'),
        supabase.from('cards').select('*'),
      ])
      if (a.error || b.error) setErro((a.error || b.error).message)
      setTx(a.data || [])
      setCards(b.data || [])
    })()
  }, [])

  let m0, m1
  if (tipo === 'mensal') { m0 = mes; m1 = mes }
  else if (tipo === 'trimestral') { m0 = mes - 2; m1 = mes }
  else if (tipo === 'anual') { const y = Math.floor(mes / 12); m0 = y * 12; m1 = y * 12 + 11 }
  else { m0 = ymOf(de); m1 = ymOf(ate) }
  const n = Math.max(1, m1 - m0 + 1)
  const ini = tipo === 'custom' ? de : mStart(m0)
  const fim = tipo === 'custom' ? ate : mEnd(m1)
  const dados = tx.filter((x) => x.due_date >= ini && x.due_date <= fim)
  const ant = tx.filter((x) => x.due_date >= mStart(m0 - n) && x.due_date <= mEnd(m0 - 1))

  const rec = soma(dados, isR)
  const des = soma(dados, isD)
  const recA = soma(ant, isR)
  const desA = soma(ant, isD)

  const linhas = []
  let acc = 0
  for (let m = m0; m <= m1 && linhas.length < 60; m++) {
    const b = dados.filter((x) => ymOf(x.due_date) === m)
    const r = soma(b, isR), d = soma(b, isD)
    acc += r - d
    linhas.push({ m, r, d, s: r - d, acc })
  }
  const mx = Math.max(1, ...linhas.flatMap((x) => [x.r, x.d]))

  const cat = {}
  dados.filter(isD).forEach((x) => { cat[x.category || 'Outros'] = (cat[x.category || 'Outros'] || 0) + Number(x.amount) })
  const porCartao = {}
  dados.filter((x) => isD(x) && x.card_id).forEach((x) => {
    const nome = (cards.find((c) => c.id === x.card_id) || {}).name || 'Cartão'
    porCartao[nome] = (porCartao[nome] || 0) + Number(x.amount)
  })
  const totalCartoes = soma(dados, (x) => isD(x) && x.card_id)

  const periodo = tipo === 'mensal' ? rotulo(mes)
    : tipo === 'trimestral' ? `${rotulo(m0)} a ${rotulo(m1)}`
    : tipo === 'anual' ? String(Math.floor(mes / 12))
    : `${br(de)} a ${br(ate)}`

  function baixar() {
    const cab = 'data;descricao;tipo;categoria;forma;cartao;valor;parcela;status'
    const rows = dados.map((x) => [
      x.due_date,
      '"' + String(x.description).replace(/"/g, '""') + '"',
      isR(x) ? 'receita' : 'despesa',
      x.category || '',
      x.pay_method || '',
      (cards.find((c) => c.id === x.card_id) || {}).name || '',
      String(x.amount).replace('.', ','),
      x.installments > 1 ? `${x.installment}/${x.installments}` : '',
      isR(x) && x.paid ? 'recebida' : status(x),
    ].join(';'))
    const blob = new Blob(['\ufeff' + [cab, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `relatorio-${ini}-a-${fim}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const barras = (o, tot) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
    <div key={k}>
      <div className="ln"><span>{k}</span><b>{R(v)} <small>({tot ? ((v / tot) * 100).toFixed(0) : 0}%)</small></b></div>
      <div className="bar"><i style={{ width: (tot ? (v / tot) * 100 : 0) + '%' }} /></div>
    </div>
  ))

  return (
    <>
      {erro && <div className="msg" onClick={() => setErro('')}>{erro}</div>}
      <div className="rel-tipo noprint">
        {[['mensal', 'Mensal'], ['trimestral', 'Trimestral'], ['anual', 'Anual'], ['custom', 'Período']].map(([k, t]) => (
          <button key={k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>{t}</button>
        ))}
      </div>
      {tipo === 'custom' ? (
        <div className="g2 noprint" style={{ marginBottom: 10 }}>
          <div><label>De</label><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
          <div><label>Até</label><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        </div>
      ) : (
        <div className="mn noprint">
          <button onClick={() => setMes(mes - (tipo === 'anual' ? 12 : 1))} aria-label="Período anterior">‹</button>
          <b>{periodo}</b>
          <button onClick={() => setMes(mes + (tipo === 'anual' ? 12 : 1))} aria-label="Próximo período">›</button>
        </div>
      )}
      <h3 style={{ margin: '4px 0 10px' }}>Relatório: {periodo}</h3>

      <section className="card">
        <div className="lbl">Saldo do período</div>
        <div className={'big' + (rec - des < 0 ? ' neg' : '')}>{R(rec - des)}</div>
      </section>
      <div className="st">
        <div>Receitas<b>{R(rec)}</b></div>
        <div>Despesas<b>{R(des)}</b></div>
        <div>Despesas pagas<b>{R(soma(dados, (x) => isD(x) && x.paid))}</b></div>
        <div>Pendentes<b>{R(soma(dados, (x) => isD(x) && status(x) === 'pendente'))}</b></div>
        <div>Vencidas<b className="neg">{R(soma(dados, (x) => isD(x) && status(x) === 'vencida'))}</b></div>
        <div>Gastos em cartões<b>{R(totalCartoes)}</b></div>
      </div>

      <section className="card">
        <h3 style={{ margin: '0 0 6px' }}>Comparativo com o período anterior</h3>
        <div className="ln"><span>Receitas</span><b>{R(rec)} <small>antes {R(recA)} ({pct(rec, recA)})</small></b></div>
        <div className="ln"><span>Despesas</span><b>{R(des)} <small>antes {R(desA)} ({pct(des, desA)})</small></b></div>
        <div className="ln"><span>Saldo</span><b>{R(rec - des)} <small>antes {R(recA - desA)}</small></b></div>
      </section>

      {linhas.length > 1 && (
        <>
          {linhas.length <= 12 && (
            <section className="card">
              <h3 style={{ margin: '0 0 10px' }}>Evolução mês a mês</h3>
              <div className="ch">
                {linhas.map((x) => (
                  <div className="cl" key={x.m}>
                    <div className="cb">
                      <i className="r" style={{ height: (x.r / mx) * 100 + '%' }} />
                      <i className="d" style={{ height: (x.d / mx) * 100 + '%' }} />
                    </div>
                    <small>{MESES[x.m % 12].slice(0, 3)}</small>
                  </div>
                ))}
              </div>
              <small>Verde: receitas. Vermelho: despesas.</small>
            </section>
          )}
          <section className="card rel-scroll">
            <h3 style={{ margin: '0 0 6px' }}>Resumo por mês</h3>
            <table className="tb">
              <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th><th>Acumulado</th></tr></thead>
              <tbody>
                {linhas.map((x) => (
                  <tr key={x.m}>
                    <td>{MESES[x.m % 12].slice(0, 3)}/{String(Math.floor(x.m / 12)).slice(2)}</td>
                    <td>{R(x.r)}</td><td>{R(x.d)}</td>
                    <td className={x.s < 0 ? 'neg' : ''}>{R(x.s)}</td>
                    <td className={x.acc < 0 ? 'neg' : ''}>{R(x.acc)}</td>
                  </tr>
                ))}
                <tr>
                  <td><b>Total</b></td><td><b>{R(rec)}</b></td><td><b>{R(des)}</b></td>
                  <td className={rec - des < 0 ? 'neg' : ''}><b>{R(rec - des)}</b></td><td />
                </tr>
              </tbody>
            </table>
          </section>
        </>
      )}

      <section className="card">
        <h3 style={{ margin: '0 0 4px' }}>Categorias com maior despesa</h3>
        {des ? barras(cat, des) : <small>Sem despesas no período.</small>}
      </section>
      {Object.keys(porCartao).length > 0 && (
        <section className="card">
          <h3 style={{ margin: '0 0 4px' }}>Gastos por cartão</h3>
          {barras(porCartao, totalCartoes)}
        </section>
      )}

      <div className="noprint">
        <button className="out" onClick={baixar}>Baixar para Excel (CSV)</button>
        <button className="out" onClick={() => window.print()}>Salvar em PDF</button>
      </div>
    </>
  )
}
