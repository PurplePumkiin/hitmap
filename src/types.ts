export type Box = { x: number; y: number; width: number; height: number };
export type XY = { x: number; y: number };
export type Position = { image: Box; percent: Box; element: Box; viewport: Box; shape?: Zone };
export type Point = { image: XY; percent: XY; element: XY; viewport: XY };
export type Zone =
  | { label: string; shape: 'rect'; x: number; y: number; width: number; height: number; data?: unknown }
  | { label: string; shape: 'ellipse'; cx: number; cy: number; rx: number; ry: number; data?: unknown }
  | { label: string; shape: 'polygon'; points: [number, number][]; data?: unknown };
export type ZonesJSON = { hitzones: 1; image: { width: number; height: number; src?: string }; zones: Zone[] };
export type Status = 'idle' | 'clicked';
export type ClickEvent = {
  label: string;
  status: 'clicked' | 'reclicked';
  clicks: number;
  data: unknown;
  position: Position;
  point: Point;
  originalEvent: Event;
};
export type MissEvent = { point: Point; originalEvent: Event };
export type LayoutEvent = { zones: { label: string; position: Position }[] };
export type Options = { keyboard?: boolean; cursor?: string; className?: string; debug?: boolean };
