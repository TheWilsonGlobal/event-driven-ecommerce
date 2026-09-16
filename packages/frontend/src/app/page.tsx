export default function Home() {
  const services = [
    { name: 'API Gateway', port: 3000, path: '/health', role: 'Perimeter Reverse Proxy & Routing' },
    { name: 'User Service', port: 3001, path: '/health', role: 'Auth, Profiles & JWT Issuance' },
    { name: 'Product Service', port: 3002, path: '/health', role: 'Catalog, Categories & Search' },
    { name: 'Order Service', port: 3003, path: '/health', role: 'Cart, Sagas & Checkout' },
    { name: 'Frontend', port: 3004, path: '/', role: 'Next.js 14 SSR Web Client' },
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <header style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1e293b' }}>
          🛒 Microservices E-Commerce Platform
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.5rem' }}>
          Node.js 18+ · TypeScript · Fastify · Prisma ORM · Next.js 14 · BullMQ
        </p>
      </header>

      <section>
        <h2 style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem', color: '#334155' }}>
          Workspace Microservices Status
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {services.map((svc) => (
            <div
              key={svc.name}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '1.25rem',
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '600', color: '#0f172a', margin: 0 }}>{svc.name}</h3>
                <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', backgroundColor: '#ecfdf5', color: '#047857', borderRadius: '9999px', fontWeight: '500' }}>
                  Port {svc.port}
                </span>
              </div>
              <p style={{ fontSize: '0.9rem', color: '#64748b', marginTop: '0.5rem', marginBottom: '1rem' }}>
                {svc.role}
              </p>
              <a
                href={`http://localhost:${svc.port}${svc.path}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-block',
                  fontSize: '0.85rem',
                  color: '#2563eb',
                  textDecoration: 'none',
                  fontWeight: '500'
                }}
              >
                Inspect endpoint &rarr;
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
