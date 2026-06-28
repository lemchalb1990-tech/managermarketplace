'use client';

import { useEffect, useRef } from 'react';

export interface MapStop {
  id: string;
  position: number;
  lat?: number | null;
  lng?: number | null;
  deliveredAt?: string | null;
  order: {
    customerName?: string | null;
    address?: string | null;
    commune?: string | null;
  };
}

export default function RouteMap({ stops }: { stops: MapStop[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<any>(null);

  const stopsWithCoords = stops.filter(s => s.lat != null && s.lng != null);

  useEffect(() => {
    if (!mapRef.current) return;

    const init = (L: any) => {
      if (instanceRef.current) {
        instanceRef.current.remove();
        instanceRef.current = null;
      }
      if (stopsWithCoords.length === 0) return;

      const map = L.map(mapRef.current!, { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      const coords: [number, number][] = [];

      stopsWithCoords.forEach((stop) => {
        const pos: [number, number] = [stop.lat!, stop.lng!];
        coords.push(pos);
        const done = !!stop.deliveredAt;
        const bg = done ? '#22c55e' : '#3b82f6';
        const icon = L.divIcon({
          html: `<div style="width:30px;height:30px;background:${bg};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${stop.position}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          className: '',
        });
        L.marker(pos, { icon })
          .addTo(map)
          .bindPopup(
            `<div style="font-size:13px;min-width:160px">
              <strong>#${stop.position} ${stop.order.customerName ?? ''}</strong><br>
              ${stop.order.address ?? ''}${stop.order.commune ? ', ' + stop.order.commune : ''}
              ${done ? '<br><span style="color:#22c55e;font-weight:600">✓ Entregado</span>' : ''}
            </div>`,
          );
      });

      if (coords.length > 1) {
        L.polyline(coords, { color: '#3b82f6', weight: 3, opacity: 0.75, dashArray: '10 6' }).addTo(map);
      }

      map.fitBounds(L.latLngBounds(coords), { padding: [28, 28] });
      instanceRef.current = map;
    };

    const loadCss = () => {
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
    };

    loadCss();

    if ((window as any).L) {
      init((window as any).L);
    } else if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => init((window as any).L);
      document.head.appendChild(script);
    } else {
      const iv = setInterval(() => {
        if ((window as any).L) { clearInterval(iv); init((window as any).L); }
      }, 100);
    }

    return () => {
      instanceRef.current?.remove();
      instanceRef.current = null;
    };
  }, [stops]);

  if (stopsWithCoords.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
        <div className="text-center px-4">
          <p className="text-4xl mb-2">🗺️</p>
          <p className="text-sm font-medium text-gray-500">Sin coordenadas disponibles</p>
          <p className="text-xs text-gray-400 mt-1">Las paradas aparecerán en el mapa una vez geocodificadas</p>
        </div>
      </div>
    );
  }

  return <div ref={mapRef} className="h-full w-full rounded-xl overflow-hidden border border-gray-200" />;
}
