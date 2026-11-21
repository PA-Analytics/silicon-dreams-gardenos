export type SceneMode = 'day' | 'night';
export type CrtState = 0 | 1 | 2 | 3;
export type TvState = 0 | 1 | 2;

export interface CameraMeta {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  forward: [number, number, number];
  quaternion: [number, number, number, number];
  lensMm: number;
  sensorWidthMm: number;
  fov43Deg: number;
  shiftX: number;
  shiftY: number;
}

export interface LightMeta {
  name: string;
  type: 'SUN' | 'POINT' | 'AREA' | 'SPOT';
  position: [number, number, number];
  direction: [number, number, number];
  color: [number, number, number];
  energy: number;
  angle: number | null;
  size: number | null;
  sizeY: number | null;
  castShadow: boolean;
}

export interface SceneMeta {
  source: string;
  viewTransform: string;
  look: string;
  exposure: number;
  cameras: CameraMeta[];
  lights: LightMeta[];
  orbit: {
    center: [number, number, number];
    target: [number, number, number];
    cameraPos: [number, number, number];
    lensMm: number;
  };
}

export interface ScreenBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface NightMeta {
  source: string;
  exposure: number;
  lights: LightMeta[];
  cameras: CameraMeta[];
  mist: {
    position: [number, number, number];
    size: [number, number, number];
  };
  screenBounds: Record<string, ScreenBounds>;
  screens: string[];
}
