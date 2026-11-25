import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  async function entrar(e) {
    e.preventDefault()
    setErro('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    if (error) setErro('E-mail ou senha incorretos.')
  }

  if (!ready) return <div className="box">Carregando…</div>

  if (!session)
    return (
      <form className="box" onSubmit={entrar}>
        <h2>Meu Controle Financeiro</h2>
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        <button>Entrar</button>
        {erro && <p className="err">{erro}</p>}
      </form>
    )

  return (
    <div className="box">
      <h2>Você está dentro ✓</h2>
      <p>{session.user.email}</p>
      <button onClick={() => supabase.auth.signOut()}>Sair</button>
    </div>
  )
}
