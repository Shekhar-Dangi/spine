"use client";
/**
 * MapCanvas — Leaflet map with geo markers.
 *
 * Imported via dynamic() with ssr:false from GeoMapWidget to avoid
 * server-side rendering errors (Leaflet requires the DOM).
 */
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoMap, GeoMarker } from "@/types";

/** Returns a colored div-icon based on confidence and selected state */
function markerIcon(confidence: GeoMarker["confidence"], selected = false): L.DivIcon {
  const colors: Record<string, string> = {
    high: "#d97706",   // amber-600
    medium: "#6b7280", // gray-500
    low: "#9ca3af",    // gray-400
  };
  const color = colors[confidence] ?? colors.medium;
  if (selected) {
    return L.divIcon({
      className: "",
      html: `<div style="
        width:20px;height:20px;border-radius:50%;
        background:${color};border:3px solid white;
        box-shadow:0 0 0 3px ${color},0 2px 6px rgba(0,0,0,0.5);
      "></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12],
    });
  }
  return L.divIcon({
    className: "",
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:${color};border:2px solid white;
      box-shadow:0 1px 3px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8],
  });
}

/** Auto-fit the map to show all markers */
function FitBounds({ markers }: { markers: GeoMarker[] }) {
  const map = useMap();
  useEffect(() => {
    if (markers.length === 0) return;
    const bounds = L.latLngBounds(markers.map((m) => [m.latitude, m.longitude]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 8 });
  }, [map, markers]);
  return null;
}

/** Invalidates Leaflet's size whenever the container changes (e.g. fullscreen toggle) */
function MapResizer({ isFullscreen }: { isFullscreen?: boolean }) {
  const map = useMap();
  useEffect(() => {
    // Wait for the CSS transition to finish before recalculating tile layout
    const timer = setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 310);
    return () => clearTimeout(timer);
  }, [map, isFullscreen]);
  return null;
}

interface Props {
  geoMap: GeoMap;
  isFullscreen?: boolean;
  selectedMarkerId?: number | null;
  onMarkerClick: (marker: GeoMarker) => void;
  onAnnotationSave: (markerId: number, annotation: string) => void;
}

export default function MapCanvas({ geoMap, isFullscreen, selectedMarkerId, onMarkerClick, onAnnotationSave }: Props) {
  const { markers } = geoMap;

  // Fallback center: world view
  const center: [number, number] = markers.length > 0
    ? [markers[0].latitude, markers[0].longitude]
    : [20, 0];

  return (
    <MapContainer
      center={center}
      zoom={3}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={19}
      />
      <FitBounds markers={markers} />
      <MapResizer isFullscreen={isFullscreen} />
      {markers.map((marker) => (
        <Marker
          key={marker.id}
          position={[marker.latitude, marker.longitude]}
          icon={markerIcon(marker.confidence, marker.id === selectedMarkerId)}
          eventHandlers={{ click: () => onMarkerClick(marker) }}
        />
      ))}
    </MapContainer>
  );
}
