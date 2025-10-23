'use client'
import React from 'react'
import { roadmap } from '@/lib/catalog/roadmap'
import { modulesCatalog } from '@/lib/catalog/modules'

export default function RoadmapPage() {
  const getModuleName = (id: number) => modulesCatalog.find(m => m.id === id)?.name || `#${id}`

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>IntelliWatt Development Roadmap</h1>
      <p style={{ color: '#6b7280', marginBottom: 32, fontSize: 16 }}>
        Strategic development plan organized into logical sprints with clear dependencies and timelines.
      </p>

      {roadmap.map(batch => (
        <section key={batch.id} style={{ 
          marginBottom: 40, 
          padding: 24, 
          border: '1px solid #e5e7eb', 
          borderRadius: 12,
          backgroundColor: batch.id <= 4 ? '#f9fafb' : '#fef3c7'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              Sprint {batch.id}: {batch.name}
            </h2>
            <div style={{ 
              padding: '4px 12px', 
              borderRadius: 20, 
              fontSize: 12, 
              fontWeight: 600,
              backgroundColor: batch.id <= 4 ? '#dbeafe' : '#fbbf24',
              color: batch.id <= 4 ? '#1e40af' : '#92400e'
            }}>
              {batch.estDuration}
            </div>
          </div>
          
          <p style={{ color: '#4b5563', marginBottom: 16, fontSize: 14 }}>
            {batch.description}
          </p>
          
          {batch.dependencies?.length ? (
            <div style={{ 
              fontSize: 13, 
              color: '#6b7280', 
              marginBottom: 16,
              padding: 8,
              backgroundColor: '#f3f4f6',
              borderRadius: 6
            }}>
              <strong>Dependencies:</strong> {batch.dependencies.map(id => `Sprint ${id}`).join(', ')}
            </div>
          ) : null}
          
          {batch.modules.length > 0 ? (
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#374151' }}>
                Modules ({batch.modules.length}):
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }}>
                {batch.modules.map(mid => {
                  const module = modulesCatalog.find(m => m.id === mid)
                  return (
                    <div key={mid} style={{ 
                      padding: 12, 
                      backgroundColor: '#fff', 
                      border: '1px solid #e5e7eb', 
                      borderRadius: 8,
                      fontSize: 13
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {module?.name || `Module #${mid}`}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: 12 }}>
                        {module?.estDevTime} • {module?.purpose}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div style={{ 
              padding: 16, 
              backgroundColor: '#f9fafb', 
              border: '1px dashed #d1d5db', 
              borderRadius: 8,
              textAlign: 'center',
              color: '#6b7280',
              fontStyle: 'italic'
            }}>
              Future modules to be defined
            </div>
          )}
        </section>
      ))}

      <div style={{ 
        marginTop: 40, 
        padding: 20, 
        backgroundColor: '#f0f9ff', 
        borderRadius: 12, 
        border: '1px solid #bae6fd' 
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: '#0c4a6e' }}>
          Development Summary
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, color: '#0369a1' }}>Total Sprints</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0c4a6e' }}>{roadmap.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 14, color: '#0369a1' }}>Completed Modules</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0c4a6e' }}>
              {roadmap.filter(b => b.id <= 4).reduce((sum, b) => sum + b.modules.length, 0)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, color: '#0369a1' }}>Total Dev Time</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0c4a6e' }}>
              {roadmap.filter(b => b.id <= 4).reduce((sum, b) => {
                const time = b.estDuration.match(/(\d+)/)?.[1] || '0'
                return sum + parseInt(time)
              }, 0)}d
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, color: '#0369a1' }}>Current Phase</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0c4a6e' }}>
              {roadmap.find(b => b.id === 4)?.name || 'Planning'}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
