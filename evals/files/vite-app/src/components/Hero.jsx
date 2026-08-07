export function Hero() {
  return (
    <section style={{ padding: "96px 24px", maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ fontSize: 48, lineHeight: 1.1, margin: 0 }}>
        Invoices that pay themselves attention
      </h1>
      <p style={{ color: "var(--ink-muted)", maxWidth: 520 }}>
        Ledgerly chases, reconciles, and files every invoice you send, so the
        money side of your studio runs itself.
      </p>
      <a
        href="/signup"
        style={{
          display: "inline-block",
          background: "var(--accent)",
          color: "var(--paper)",
          padding: "12px 22px",
          borderRadius: "var(--radius)",
          textDecoration: "none",
        }}
      >
        Start free
      </a>
    </section>
  );
}
