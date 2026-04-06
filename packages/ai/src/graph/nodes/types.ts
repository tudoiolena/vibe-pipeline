import { z } from "zod";
import {
  PipelineStateSchema,
  type PipelineState,
  PipelineStateUpdateSchema,
  type PipelineStateUpdate
} from "../state";

export type PipelineNode = (state: PipelineState) => PipelineStateUpdate | Promise<PipelineStateUpdate>;

export function createPipelineNode(_name: string, handler: PipelineNode): PipelineNode {
  return async (state) => {
    const parsedState = PipelineStateSchema.parse(state);
    const rawUpdate = await handler(parsedState);
    const parsedUpdate = PipelineStateUpdateSchema.parse(rawUpdate);
    return z.record(z.unknown()).parse(parsedUpdate) as PipelineStateUpdate;
  };
}
