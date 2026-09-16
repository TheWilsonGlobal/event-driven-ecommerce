'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface ServiceItem {
  id: string;
  name: string;
  port: number;
  url: string;
  healthUrl: string;
  type: string;
  role: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  statusCode: number;
  latencyMs: number;
  details?: any;
  error?: string;
  lastChecked: string;
}

interface ConfigData {
  environment: {
    nodeEnv: string;
    apiVersion: string;
    logLevel: string;
  };
  ports: Record<string, number>;
  persistence: {
    mode: string;
    relational: {
      driver: string;
      postgresHost: string;
      postgresPort: number;
      postgresDatabase: string;
      sqlitePath: string;
      activeUrl: string;
    };
    document: {
      driver: string;
      mongodbUri: string;
      nedbDataPath: string;
      nedbInMemory: boolean;
    };
    keyValue: {
      driver: string;
      redisHost: string;
      redisPort: number;
      redisDb: number;
      rocksdbDataPath: string;
      embeddedInMemory: boolean;
    };
  };
  queues: {
    broker: string;
    concurrency: number;
    orderExpirationMinutes: number;
    maxRetries: number;
  };
  security: {
    jwtExpiresIn: string;
    jwtRefreshExpiresIn: string;
    bcryptSaltRounds: number;
    allowedOrigins: string;
  };
  payments: {
    paypalMode: string;
    mockExternalApis: boolean;
  };
  search: {
    elasticsearchHost: string;
    elasticsearchIndex: string;
  };
}

export default function AdminDashboard() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);
  const [activeTab, setActiveTab] = useState<'services' | 'persistence' | 'config'>('services');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch('/api/status', { cache: 'no-store' }),
        fetch('/api/config', { cache: 'no-store' }),
      ]);

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setServices(statusData.services || []);
      }
      if (configRes.ok) {
        const cfgData = await configRes.json();
        setConfig(cfgData.config || null);
      }
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error('Failed to fetch admin data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData, autoRefresh]);

  const onlineCount = services.filter((s) => s.status === 'HEALTHY').length;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#f8fafc', padding: '24px' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #334155',
            paddingBottom: '20px',
            marginBottom: '24px',
            gap: '16px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0, color: '#38bdf8' }}>
                ⚡ Microservices Admin Cockpit
              </h1>
              <span
                style={{
                  fontSize: '12px',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: '600',
                }}
              >
                v1.0.0
              </span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: '4px 0 0 0' }}>
              Centralized topology monitoring, live health status, and system configuration control plane
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              {loading ? 'Fetching status...' : `Last updated: ${lastUpdated}`}
            </span>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              style={{
                backgroundColor: autoRefresh ? '#065f46' : '#334155',
                color: autoRefresh ? '#34d399' : '#94a3b8',
                border: '1px solid #1e293b',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: '500',
              }}
            >
              {autoRefresh ? '● Auto-Refresh: ON (5s)' : '○ Auto-Refresh: OFF'}
            </button>
            <button
              onClick={() => {
                setLoading(true);
                fetchData();
              }}
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '13px',
                cursor: 'pointer',
                fontWeight: '600',
              }}
            >
              {loading ? '⏳ Refreshing...' : '🔄 Refresh Now'}
            </button>
          </div>
        </header>

        {/* Stats Row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>Services Operational</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: onlineCount === services.length && services.length > 0 ? '#34d399' : '#fbbf24' }}>
              {onlineCount} / {services.length}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              {onlineCount === services.length && services.length > 0 ? 'All services running normally' : 'Some services offline'}
            </div>
          </div>

          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>Persistence Mode</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#38bdf8' }}>
              {config?.persistence?.mode?.toUpperCase() || 'SERVER'}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              Relational: {config?.persistence?.relational?.driver || 'postgres'} · Doc: {config?.persistence?.document?.driver || 'mongodb'}
            </div>
          </div>

          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>Distributed Task Queues</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#c084fc' }}>
              BullMQ 4.11
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              Concurrency: {config?.queues?.concurrency || 10} · Retries: {config?.queues?.maxRetries || 5}
            </div>
          </div>

          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '16px' }}>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>Runtime Environment</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>
              {config?.environment?.nodeEnv?.toUpperCase() || 'DEVELOPMENT'}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              API Version: {config?.environment?.apiVersion || 'v1'}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #334155', paddingBottom: '12px', marginBottom: '20px' }}>
          <button
            onClick={() => setActiveTab('services')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'services' ? '#38bdf8' : '#1e293b',
              color: activeTab === 'services' ? '#0f172a' : '#94a3b8',
            }}
          >
            📡 Microservices Registry ({services.length})
          </button>
          <button
            onClick={() => setActiveTab('persistence')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'persistence' ? '#38bdf8' : '#1e293b',
              color: activeTab === 'persistence' ? '#0f172a' : '#94a3b8',
            }}
          >
            💾 Persistence & Storage Drivers
          </button>
          <button
            onClick={() => setActiveTab('config')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'config' ? '#38bdf8' : '#1e293b',
              color: activeTab === 'config' ? '#0f172a' : '#94a3b8',
            }}
          >
            ⚙️ Environment & Security Matrix
          </button>
        </div>

        {/* Tab Content: Services */}
        {activeTab === 'services' && (
          <div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '16px',
                marginBottom: '24px',
              }}
            >
              {services.map((svc) => (
                <div
                  key={svc.id}
                  style={{
                    backgroundColor: '#1e293b',
                    border: svc.status === 'HEALTHY' ? '1px solid #059669' : '1px solid #475569',
                    borderRadius: '8px',
                    padding: '18px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 4px 0', color: '#f8fafc' }}>
                        {svc.name}
                      </h3>
                      <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                        Port <strong>{svc.port}</strong> · {svc.type.toUpperCase()}
                      </span>
                    </div>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: '700',
                        backgroundColor: svc.status === 'HEALTHY' ? '#064e3b' : '#7f1d1d',
                        color: svc.status === 'HEALTHY' ? '#34d399' : '#fca5a5',
                      }}
                    >
                      {svc.status}
                    </span>
                  </div>

                  <p style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '16px', minHeight: '36px' }}>
                    {svc.role}
                  </p>

                  <div style={{ backgroundColor: '#0f172a', padding: '10px', borderRadius: '6px', fontSize: '12px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ color: '#94a3b8' }}>Health Endpoint:</span>
                      <a href={svc.healthUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>
                        {svc.healthUrl}
                      </a>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>Response Latency:</span>
                      <span style={{ color: svc.status === 'HEALTHY' ? '#34d399' : '#f87171' }}>
                        {svc.status === 'HEALTHY' ? `${svc.latencyMs} ms` : 'N/A'}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setSelectedService(svc)}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        backgroundColor: '#334155',
                        color: '#f8fafc',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: '500',
                      }}
                    >
                      🔍 Inspect Details
                    </button>
                    <a
                      href={svc.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#0284c7',
                        color: '#ffffff',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '500',
                        textAlign: 'center',
                      }}
                    >
                      Open &rarr;
                    </a>
                  </div>
                </div>
              ))}
            </div>

            {/* Modal / Inspector for selected service */}
            {selectedService && (
              <div
                style={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #38bdf8',
                  borderRadius: '8px',
                  padding: '20px',
                  marginTop: '16px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: '#38bdf8' }}>
                    Inspector: {selectedService.name} (Port {selectedService.port})
                  </h3>
                  <button
                    onClick={() => setSelectedService(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: '16px',
                      cursor: 'pointer',
                    }}
                  >
                    ✖ Close
                  </button>
                </div>
                <pre
                  style={{
                    backgroundColor: '#0f172a',
                    padding: '14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: '#34d399',
                    overflowX: 'auto',
                    margin: 0,
                  }}
                >
                  {JSON.stringify(selectedService, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Tab Content: Persistence */}
        {activeTab === 'persistence' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
            {/* Relational Database */}
            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: '#38bdf8' }}>
                  🗄️ Relational Persistence
                </h3>
                <span style={{ fontSize: '12px', backgroundColor: '#0369a1', padding: '2px 8px', borderRadius: '4px' }}>
                  User & Order Services
                </span>
              </div>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>Active Driver</td>
                    <td style={{ padding: '8px 0', fontWeight: '600', color: '#34d399' }}>
                      {config?.persistence?.relational?.driver?.toUpperCase()}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>ORM Engine</td>
                    <td style={{ padding: '8px 0', fontWeight: '600' }}>Prisma ORM 5.22</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>PostgreSQL Target</td>
                    <td style={{ padding: '8px 0' }}>
                      {config?.persistence?.relational?.postgresHost}:{config?.persistence?.relational?.postgresPort} / {config?.persistence?.relational?.postgresDatabase}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>SQLite Fallback Path</td>
                    <td style={{ padding: '8px 0', color: '#cbd5e1' }}>
                      {config?.persistence?.relational?.sqlitePath}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Document Database */}
            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: '#34d399' }}>
                  📄 Document & Catalog Storage
                </h3>
                <span style={{ fontSize: '12px', backgroundColor: '#065f46', padding: '2px 8px', borderRadius: '4px' }}>
                  Product Service & Sessions
                </span>
              </div>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>Active Driver</td>
                    <td style={{ padding: '8px 0', fontWeight: '600', color: '#34d399' }}>
                      {config?.persistence?.document?.driver?.toUpperCase()}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>MongoDB URI</td>
                    <td style={{ padding: '8px 0' }}>{config?.persistence?.document?.mongodbUri}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>NeDB Embedded Path</td>
                    <td style={{ padding: '8px 0', color: '#cbd5e1' }}>{config?.persistence?.document?.nedbDataPath}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Key-Value & Queue */}
            <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0, color: '#c084fc' }}>
                  ⚡ Key-Value Cache & Task Queues
                </h3>
                <span style={{ fontSize: '12px', backgroundColor: '#581c87', padding: '2px 8px', borderRadius: '4px' }}>
                  BullMQ & Cross-Service Cache
                </span>
              </div>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>Active Driver</td>
                    <td style={{ padding: '8px 0', fontWeight: '600', color: '#34d399' }}>
                      {config?.persistence?.keyValue?.driver?.toUpperCase()}
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #334155' }}>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>Redis Host & Port</td>
                    <td style={{ padding: '8px 0' }}>
                      {config?.persistence?.keyValue?.redisHost}:{config?.persistence?.keyValue?.redisPort} (DB {config?.persistence?.keyValue?.redisDb})
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px 0', color: '#94a3b8' }}>RocksDB Storage Path</td>
                    <td style={{ padding: '8px 0', color: '#cbd5e1' }}>{config?.persistence?.keyValue?.rocksdbDataPath}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab Content: Configuration */}
        {activeTab === 'config' && (
          <div style={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '16px', color: '#38bdf8' }}>
              System Configuration Parameters
            </h3>
            <pre
              style={{
                backgroundColor: '#0f172a',
                padding: '16px',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#e2e8f0',
                overflowX: 'auto',
                margin: 0,
              }}
            >
              {JSON.stringify(config, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
