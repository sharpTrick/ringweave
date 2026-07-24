export default function App() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '42rem',
        margin: '0 auto',
        padding: '4rem 1.5rem',
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ marginBottom: '0.25rem' }}>Hello, world 👋</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        This is <strong>BuddyGraph</strong>, the reference app for the{' '}
        <a href="https://github.com/sharpTrick/ringweave">ringweave</a> core.
      </p>
      <p>
        Placeholder page — the real UI (Ring / Force / Focus layouts wired to the
        constrained graph core) lands in milestone M2. For now this confirms the
        Vite build and the GitHub Pages deploy are working end to end.
      </p>
    </main>
  )
}
