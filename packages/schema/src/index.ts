export {
  BriefSchema,
  ClarificationCategorySchema,
  DesignMapSchema,
  DesignNodeSchema,
  DesignNodeTypeSchema,
  DesignTaskRelationSchema,
  FunctionalRequirementSchema,
  PRDSchema,
  PrioritySchema,
  SourceLinkSchema,
  StageSchema,
  TaskNodeSchema,
  TaskStatusSchema,
  TaskTreeSchema,
  TaskTypeSchema,
  UserStorySchema
} from "./schemas";
export type { TaskNode } from "./schemas";
export { prdDocumentToMarkdown } from "./prd-to-markdown";
export { validateWithSchema } from "./validators";
export type { ValidationFailure, ValidationResult, ValidationSuccess } from "./validators";

import { z } from "zod";
import {
  BriefSchema,
  ClarificationCategorySchema,
  DesignMapSchema,
  PRDSchema,
  PrioritySchema,
  StageSchema,
  TaskTreeSchema
} from "./schemas";

export type Brief = z.infer<typeof BriefSchema>;
export type PRD = z.infer<typeof PRDSchema>;
export type TaskTree = z.infer<typeof TaskTreeSchema>;
export type DesignMap = z.infer<typeof DesignMapSchema>;
export type PipelineStage = z.infer<typeof StageSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type ClarificationCategory = z.infer<typeof ClarificationCategorySchema>;
