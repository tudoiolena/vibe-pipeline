import { z } from "zod";

export type ValidationSuccess<T> = {
  success: true;
  data: T;
};

export type ValidationFailure = {
  success: false;
  errors: Array<{
    path: string;
    message: string;
    code: string;
  }>;
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function validateWithSchema<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);

  if (result.success) {
    return {
      success: true,
      data: result.data
    };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code
    }))
  };
}
