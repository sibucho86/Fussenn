export const CONNECTOR_SIDES = ["top", "right", "bottom", "left"] as const;
export type ConnectorSide = (typeof CONNECTOR_SIDES)[number];
export type ConnectorAttachment = { side: ConnectorSide; ratio: number };
export type ConnectorAdjustment = {
  source: ConnectorAttachment & { segment: number };
  target: ConnectorAttachment;
  bend: { x: number; y: number };
};
