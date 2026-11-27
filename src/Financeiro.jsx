import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './app.css'
import Relatorios from './Relatorios'
import Orcamento from './Orcamento'
import Calendario from './Calendario'
import Bancos, { SeletorConta, SaldoTotal } from './Contas'

const R = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const ymOf = (d) => { const p = d.split('-'); return Number(p[0]) * 12 + Number(p[1]) - 1 }
const lastDay = (y, m) => new Date(y, m + 1, 0).getDate()
const addM = (d, n) => {
  const p = d.split('-').map(Number)
  const t = p[0] * 12 + p[1] - 1 + n
  const y = Math.floor(t / 12), m = t % 12
  return iso(y, m, Math.min(p[2], lastDay(y, m)))
}
const addD = (d, n) => {
  const t = new Date(d + 'T12:00:00')
  t.setDate(t.getDate() + n)
  return iso(t.getFullYear(), t.getMonth(), t.getDate())
}
const hoje = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()) }
const dias = (d) => Math.round((new Date(d + 'T12:00:00') - new Date(hoje() + 'T12:00:00')) / 864e5)
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const rotulo = (t) => `${MESES[t % 12]} ${Math.floor(t / 12)}`
const CATS = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Compras', 'Financiamentos', 'Empréstimos', 'Outros']
const num = (s) => { s = String(s).trim(); return parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) }
const soma = (a, f = () => true) => a.filter(f).reduce((s, x) => s + Number(x.amount), 0)
const isR = (x) => x.kind === 'receita'
const isD = (x) => x.kind === 'despesa'
const status = (x) => (x.paid ? 'paga' : dias(x.due_date) < 0 ? 'vencida' : 'pendente')
const vazio = { tipo: 'despesa', desc: '', valor: '', data: hoje(), cat: 'Moradia', pay: 'Pix', cartao: '', n: 1, total: false, rec: 'unica', reps: '12', conta: '' }
const cvazio = { name: '', bank: '', flag: 'Visa', limit: '', close: '', due: '', color: '#0b6e63' }

function vencFatura(c, compra) {
  const p = compra.split('-').map(Number)
  let t = p[0] * 12 + p[1] - 1
  if (p[2] > c.close_day) t++
  if (c.due_day <= c.close_day) t++
  const y = Math.floor(t / 12), m = t % 12
  return iso(y, m, Math.min(c.due_day, lastDay(y, m)))
}

export default function Financeiro({ session }) {
  const agora = new Date()
  const [tx, setTx] = useState([])
  const [cards, setCards] = useState([])
  const [aba, setAba] = useState('painel')
  const [mes, setMes] = useState(agora.getFullYear() * 12 + agora.getMonth())
  const [cardId, setCardId] = useState(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todas')
  const [f, setF] = useState(vazio)
  const [cf, setCf] = useState(cvazio)
  const [novoCartao, setNovoCartao] = useState(false)
  const [msg, setMsg] = useState('')
  const [ed, setEd] = useState(null)
  const [serie, setSerie] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const setC = (k) => (e) => setCf({ ...cf, [k]: e.target.value })

  async function carregar() {
    const [a, b] = await Promise.all([
      supabase.from('transactions').select('*').order('due_date'),
      supabase.from('cards').select('*').order('name'),
    ])
    if (a.error || b.error) setMsg((a.error || b.error).message)
    setTx(a.data || [])
    setCards(b.data || [])
  }
  useEffect(() => { carregar() }, [])

  const ini = iso(Math.floor(mes / 12), mes % 12, 1)
  const fim = iso(Math.floor(mes / 12), mes % 12, lastDay(Math.floor(mes / 12), mes % 12))

  function editar(x) {
    setEd(x)
    setSerie(false)
    setF({
      ...vazio,
      tipo: isR(x) ? 'receita' : x.card_id ? 'cartao' : 'despesa',
      desc: x.description,
      valor: String(x.amount).replace('.', ','),
      data: x.due_date,
      cat: CATS.includes(x.category) ? x.category : 'Outros',
      pay: x.pay_method || 'Pix',
      conta: x.account_id || '',
    })
    setAba('novo')
  }
  async function marcar(x) { await supabase.from('transactions').update({ paid: !x.paid }).eq('id', x.id); carregar() }
  async function excluir(x) { await supabase.from('transactions').delete().eq('id', x.id); carregar() }
  async function excluirSerie(x) { await supabase.from('transactions').delete().eq('group_id', x.group_id).gte('due_date', x.due_date); carregar() }
  async function pagarFatura(c, v) {
    await supabase.from('transactions').update({ paid: v }).eq('card_id', c.id).gte('due_date', ini).lte('due_date', fim)
    carregar()
  }
  async function excluirCartao(c) { await supabase.from('cards').delete().eq('id', c.id); setCardId(null); carregar() }

  async function salvar(e) {
    e.preventDefault()
    const v = num(f.valor)
    if (!f.desc.trim() || !(v > 0) || !f.data) return setMsg('Preencha descrição, valor e data.')
    if (ed) {
      const dados = { description: f.desc.trim(), amount: v, due_date: f.data, category: f.tipo === 'receita' ? 'Receita' : f.cat, account_id: f.conta || null }
      if (f.tipo === 'despesa') dados.pay_method = f.pay
      const { error: e1 } = await supabase.from('transactions').update(dados).eq('id', ed.id)
      if (e1) return setMsg(e1.message)
      if (serie && ed.group_id) {
        const { due_date: _d, ...resto } = dados
        await supabase.from('transactions').update(resto).eq('group_id', ed.group_id).gt('due_date', ed.due_date)
      }
      setMes(ymOf(f.data))
      setEd(null)
      setF(vazio)
      setAba('contas')
      carregar()
      return setMsg('Lançamento atualizado.')
    }
    const g = crypto.randomUUID()
    const base = {
      description: f.desc.trim(),
      category: f.tipo === 'receita' ? 'Receita' : f.cat,
      kind: f.tipo === 'receita' ? 'receita' : 'despesa',
      group_id: g,
      paid: false,
      account_id: f.conta || null,
    }
    const linhas = []
    if (f.tipo === 'cartao') {
      const c = cards.find((k) => k.id === (f.cartao || (cards[0] && cards[0].id)))
      if (!c) return setMsg('Cadastre um cartão primeiro, na aba Cartões.')
      const n = Math.max(1, Math.min(60, parseInt(f.n) || 1))
      const per = f.total ? Math.round((v / n) * 100) / 100 : v
      const primeira = vencFatura(c, f.data)
      for (let i = 0; i < n; i++) {
        const val = f.total && i === n - 1 ? Math.round((v - per * (n - 1)) * 100) / 100 : per
        linhas.push({ ...base, card_id: c.id, pay_method: 'Cartão', amount: val, due_date: addM(primeira, i), installment: i + 1, installments: n })
      }
    } else {
      const passo = { unica: 0, semanal: 7, mensal: 1, trimestral: 3, anual: 12 }[f.rec]
      const qtd = f.rec === 'unica' ? 1 : Math.max(2, Math.min(60, parseInt(f.reps) || 12))
      for (let i = 0; i < qtd; i++) {
        linhas.push({
          ...base, amount: v, recurrence: f.rec,
          pay_method: f.tipo === 'despesa' ? f.pay : null,
          due_date: f.rec === 'semanal' ? addD(f.data, 7 * i) : addM(f.data, passo * i),
          installment: qtd > 1 ? i + 1 : null,
          installments: qtd > 1 ? qtd : null,
        })
      }
    }
    const { error } = await supabase.from('transactions').insert(linhas)
    if (error) return setMsg(error.message)
    setMes(ymOf(linhas[0].due_date))
    setF(vazio)
    setAba('contas')
    carregar()
    setMsg('Lançamento salvo.')
  }

  async function addCartao(e) {
    e.preventDefault()
    const limite = num(cf.limit), fech = parseInt(cf.close), venc = parseInt(cf.due)
    if (!cf.name.trim() || !(limite >= 0) || !(fech >= 1 && fech <= 31) || !(venc >= 1 && venc <= 31))
      return setMsg('Preencha nome, limite e os dias de fechamento e vencimento.')
    const { error } = await supabase.from('cards').insert({ name: cf.name.trim(), bank: cf.bank, flag: cf.flag, credit_limit: limite, close_day: fech, due_day: venc, color: cf.color })
    if (error) return setMsg(error.message)
    setCf(cvazio); setNovoCartao(false); carregar()
  }

  const doMes = tx.filter((x) => ymOf(x.due_date) === mes)
  const rec = soma(doMes, isR)
  const des = soma(doMes, isD)
  const ant = soma(tx.filter((x) => ymOf(x.due_date) === mes - 1), isD)
  const prox = tx.filter((x) => isD(x) && !x.paid && dias(x.due_date) <= 7).slice(0, 8)
  const cat = {}
  doMes.filter(isD).forEach((x) => { cat[x.category] = (cat[x.category] || 0) + Number(x.amount) })
  const m6 = [0, 1, 2, 3, 4, 5].map((i) => {
    const m = mes - 5 + i
    const b = tx.filter((x) => ymOf(x.due_date) === m)
    return { m, r: soma(b, isR), d: soma(b, isD) }
  })
  const mx = Math.max(1, ...m6.flatMap((x) => [x.r, x.d]))

  const barras = (o, tot) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
    <div key={k}>
      <div className="ln"><span>{k}</span><b>{R(v)}</b></div>
      <div className="bar"><i style={{ width: (tot ? (v / tot) * 100 : 0) + '%' }} /></div>
    </div>
  ))

  const linha = (x) => {
    const s = status(x)
    const c = cards.find((k) => k.id === x.card_id)
    const serieX = x.group_id && tx.filter((y) => y.group_id === x.group_id).length > 1
    return (
      <div key={x.id} className={'row' + (x.paid ? ' ok' : '')}>
        <button className="chk" onClick={() => marcar(x)} aria-label="Marcar como paga">{x.paid ? '✓' : ''}</button>
        <div className="inf">
          <b>{x.description}{x.installments > 1 && <small> {x.installment}/{x.installments}</small>}</b>
          <small>{x.due_date.slice(8)}/{x.due_date.slice(5, 7)}, {x.category}{c ? ', ' + c.name : x.pay_method ? ', ' + x.pay_method : ''} <span className={'bd ' + s}>{isR(x) && s === 'paga' ? 'recebida' : s}</span></small>
        </div>
        <div className={'val ' + (isR(x) ? 'pos' : '')}>{isR(x) ? '+' : ''}{R(x.amount)}</div>
        <div className="act">
          <button onClick={() => editar(x)}>Editar</button>
          <button onClick={() => excluir(x)}>Excluir</button>
          {serieX && <button onClick={() => excluirSerie(x)}>Excluir daqui em diante</button>}
        </div>
      </div>
    )
  }

  const cab = (
    <div className="mn">
      <button onClick={() => setMes(mes - 1)} aria-label="Mês anterior">‹</button>
      <b>{rotulo(mes)}</b>
      <button onClick={() => setMes(mes + 1)} aria-label="Próximo mês">›</button>
    </div>
  )

  const painel = (
    <>
      {cab}
      <SaldoTotal tx={tx} />
      <section className="card">
        <div className="lbl">Saldo do mês (receitas menos despesas)</div>
        <div className={'big' + (rec - des < 0 ? ' neg' : '')}>{R(rec - des)}</div>
        {ant > 0 && <small>Despesas {des >= ant ? '+' : ''}{(((des - ant) / ant) * 100).toFixed(0)}% em relação ao mês anterior</small>}
      </section>
      <div className="st">
        <div>Receitas<b>{R(rec)}</b></div>
        <div>Despesas<b>{R(des)}</b></div>
        <div>A pagar<b>{R(soma(doMes, (x) => isD(x) && !x.paid))}</b></div>
        <div>Pagas<b>{R(soma(doMes, (x) => isD(x) && x.paid))}</b></div>
        <div>Vencidas (total)<b className="neg">{R(soma(tx, (x) => isD(x) && status(x) === 'vencida'))}</b></div>
        <div>Cartões no mês<b>{R(soma(doMes, (x) => isD(x) && x.card_id))}</b></div>
      </div>
      <section className="card">
        <h3 style={{ margin: '0 0 6px' }}>Vencidas e próximos 7 dias</h3>
        {prox.length === 0 && <small>Nenhuma conta vencendo. Tudo em dia.</small>}
        {prox.map((x) => (
          <div className="ln" key={x.id}>
            <span>{x.description}<small> {dias(x.due_date) < 0 ? `venceu há ${-dias(x.due_date)} d` : dias(x.due_date) === 0 ? 'vence hoje' : `vence em ${dias(x.due_date)} d`}</small></span>
            <span><b>{R(x.amount)}</b> <button onClick={() => marcar(x)}>Pagar</button></span>
          </div>
        ))}
      </section>
      <section className="card">
        <h3 style={{ margin: '0 0 10px' }}>Receitas e despesas, 6 meses</h3>
        <div className="ch">
          {m6.map((x) => (
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
      <section className="card">
        <h3 style={{ margin: '0 0 4px' }}>Despesas por categoria</h3>
        {des ? barras(cat, des) : <small>Sem despesas neste mês.</small>}
      </section>
    </>
  )

  let lista = doMes.filter((x) => (x.description + x.category).toLowerCase().includes(busca.toLowerCase()))
  if (filtro !== 'todas') lista = lista.filter((x) => status(x) === filtro)
  const contas = (
    <>
      {cab}
      <div className="g2" style={{ marginBottom: 10 }}>
        <input placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          {['todas', 'pendente', 'paga', 'vencida'].map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>
      {lista.length ? lista.map(linha) : <p className="empty">Nada encontrado em {rotulo(mes)}. Toque em Novo para lançar contas, receitas ou compras no cartão.</p>}
    </>
  )

  const usado = (c) => soma(tx, (x) => x.card_id === c.id && !x.paid)
  const cartao = cards.find((c) => c.id === cardId)
  const itensCartao = cartao ? doMes.filter((x) => x.card_id === cartao.id) : []
  const totalFatura = soma(itensCartao)
  const faturaPaga = itensCartao.length > 0 && itensCartao.every((x) => x.paid)
  const catCartao = {}
  itensCartao.forEach((x) => { catCartao[x.category] = (catCartao[x.category] || 0) + Number(x.amount) })

  const cartoes = cartao ? (
    <>
      <button onClick={() => setCardId(null)}>‹ Todos os cartões</button>
      <h3 style={{ margin: '10px 0 2px' }}>{cartao.name}</h3>
      <small>Limite {R(cartao.credit_limit)}, usado {R(usado(cartao))}, disponível {R(cartao.credit_limit - usado(cartao))}. Fecha dia {cartao.close_day}; melhor dia de compra: {(cartao.close_day % 31) + 1}; vence dia {cartao.due_day}.</small>
      <div style={{ height: 10 }} />
      {cab}
      <section className="card">
        <div className="lbl">Fatura de {rotulo(mes)} ({faturaPaga ? 'paga' : 'em aberto'})</div>
        <div className="big">{R(totalFatura)}</div>
        {itensCartao.length > 0 && (
          <button className="out" onClick={() => pagarFatura(cartao, !faturaPaga)}>
            {faturaPaga ? 'Desfazer pagamento da fatura' : 'Marcar fatura como paga'}
          </button>
        )}
      </section>
      {itensCartao.length ? itensCartao.map(linha) : <p className="empty">Sem compras nesta fatura.</p>}
      {totalFatura > 0 && <section className="card"><h3 style={{ margin: '0 0 4px' }}>Compras por categoria</h3>{barras(catCartao, totalFatura)}</section>}
      <button className="out" onClick={() => excluirCartao(cartao)}>Excluir cartão e suas compras</button>
    </>
  ) : (
    <>
      <h3 style={{ margin: '6px 0 12px' }}>Meus cartões</h3>
      {cards.length === 0 && <p className="empty">Nenhum cartão cadastrado.</p>}
      {cards.map((c) => (
        <div key={c.id} className="cc" style={{ background: c.color }} onClick={() => setCardId(c.id)}>
          <b>{c.name}</b> <small>{c.bank}, {c.flag}</small>
          <div style={{ fontSize: 22, fontWeight: 800, margin: '6px 0' }}>{R(c.credit_limit - usado(c))} <small>disponível</small></div>
          <div className="bar"><i style={{ width: Math.min(100, c.credit_limit ? (usado(c) / c.credit_limit) * 100 : 0) + '%' }} /></div>
          <small>Usado {R(usado(c))} de {R(c.credit_limit)}. Fecha dia {c.close_day}, vence dia {c.due_day}.</small>
        </div>
      ))}
      {novoCartao ? (
        <form className="card" onSubmit={addCartao}>
          <label>Nome do cartão</label><input value={cf.name} onChange={setC('name')} />
          <div className="g2">
            <div><label>Banco</label><input value={cf.bank} onChange={setC('bank')} /></div>
            <div><label>Bandeira</label>
              <select value={cf.flag} onChange={setC('flag')}>{['Visa', 'Mastercard', 'Elo', 'Amex', 'Outra'].map((b) => <option key={b}>{b}</option>)}</select>
            </div>
          </div>
          <label>Limite total (R$)</label><input inputMode="decimal" value={cf.limit} onChange={setC('limit')} />
          <div className="g2">
            <div><label>Dia de fechamento</label><input type="number" min="1" max="31" value={cf.close} onChange={setC('close')} /></div>
            <div><label>Dia de vencimento</label><input type="number" min="1" max="31" value={cf.due} onChange={setC('due')} /></div>
          </div>
          <label>Cor</label><input type="color" value={cf.color} onChange={setC('color')} />
          <button className="go">Salvar cartão</button>
        </form>
      ) : (
        <button className="go" onClick={() => setNovoCartao(true)}>Adicionar cartão</button>
      )}
    </>
  )

  const rotData = f.tipo === 'cartao' ? 'Data da compra' : f.tipo === 'receita' ? 'Data de recebimento' : 'Vencimento'
  const rotConta = f.tipo === 'cartao' ? 'Conta que paga a fatura' : f.tipo === 'receita' ? 'Conta de destino' : 'Conta de saída'
  const novo = (
    <form className="card" onSubmit={salvar}>
      {ed && <div className="lbl" style={{ marginBottom: 8 }}>Editando lançamento</div>}
      <div className="seg">
        {[['despesa', 'Despesa'], ['cartao', 'Compra no cartão'], ['receita', 'Receita']].map(([k, t]) => (
          <button type="button" key={k} className={f.tipo === k ? 'on' : ''} onClick={() => !ed && setF({ ...f, tipo: k })}>{t}</button>
        ))}
      </div>
      <label>Descrição</label><input value={f.desc} onChange={set('desc')} placeholder="Ex.: Aluguel, TV, Salário" />
      <div className="g2">
        <div><label>Valor (R$)</label><input inputMode="decimal" value={f.valor} onChange={set('valor')} /></div>
        <div><label>{rotData}</label><input type="date" value={f.data} onChange={set('data')} /></div>
      </div>
      {f.tipo !== 'receita' && (
        <>
          <label>Categoria</label>
          <select value={f.cat} onChange={set('cat')}>{CATS.map((c) => <option key={c}>{c}</option>)}</select>
        </>
      )}
      {f.tipo === 'despesa' && (
        <>
          <label>Forma de pagamento</label>
          <select value={f.pay} onChange={set('pay')}>{['Pix', 'Débito', 'Boleto', 'Dinheiro', 'Transferência'].map((c) => <option key={c}>{c}</option>)}</select>
        </>
      )}
      <SeletorConta rotulo={rotConta} value={f.conta} onChange={set('conta')} />
      {ed ? null : f.tipo === 'cartao' ? (
        <>
          <label>Cartão</label>
          <select value={f.cartao || (cards[0] && cards[0].id) || ''} onChange={set('cartao')}>
            {cards.length === 0 && <option value="">Cadastre um cartão na aba Cartões</option>}
            {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="g2">
            <div><label>Parcelas</label><input type="number" min="1" max="60" value={f.n} onChange={set('n')} /></div>
            <label className="ck" style={{ marginTop: 34 }}><input type="checkbox" checked={f.total} onChange={set('total')} />Valor é o total</label>
          </div>
        </>
      ) : (
        <>
          <label>Recorrência</label>
          <select value={f.rec} onChange={set('rec')}>
            <option value="unica">Única</option>
            <option value="semanal">Semanal</option>
            <option value="mensal">Mensal</option>
            <option value="trimestral">Trimestral</option>
            <option value="anual">Anual</option>
          </select>
          {f.rec !== 'unica' && (
            <>
              <label>Quantas vezes (parcelas)</label>
              <select value={f.reps} onChange={set('reps')}>
                {[2, 3, 4, 5, 6, 8, 10, 12, 18, 24, 36].map((n) => <option key={n} value={n}>{n} vezes</option>)}
              </select>
            </>
          )}
        </>
      )}
      {ed && ed.group_id && (
        <label className="ck"><input type="checkbox" checked={serie} onChange={(e) => setSerie(e.target.checked)} />Aplicar também às próximas parcelas</label>
      )}
      <button className="go">{ed ? 'Salvar alterações' : 'Salvar lançamento'}</button>
      {ed && <button type="button" className="out" onClick={() => { setEd(null); setF(vazio); setAba('contas') }}>Cancelar edição</button>}
    </form>
  )

  return (
    <div className="app">
      <div className="topo">
        <span>{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
      {msg && <div className="msg" onClick={() => setMsg('')}>{msg}</div>}
      {aba === 'painel' && painel}
      {aba === 'contas' && contas}
      {aba === 'cartoes' && cartoes}
      {aba === 'novo' && novo}
      {aba === 'relatorios' && <Relatorios />}
      {aba === 'orcamento' && <Orcamento />}
      {aba === 'calendario' && <Calendario />}
      {aba === 'bancos' && <Bancos />}
      <nav>
        {[['painel', 'Painel'], ['contas', 'Contas'], ['cartoes', 'Cartões'], ['novo', 'Novo'], ['relatorios', 'Relatórios'], ['orcamento', 'Orçamento'], ['calendario', 'Calendário'], ['bancos', 'Bancos']].map(([k, t]) => (
          <button key={k} className={aba === k ? 'on' : ''} onClick={() => { setAba(k); setCardId(null); if (k !== 'novo' && ed) { setEd(null); setF(vazio) } }}>{t}</button>
        ))}
      </nav>
    </div>
  )
}
