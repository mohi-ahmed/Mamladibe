import mongoose, { type Model, type Schema } from 'mongoose';

export const BASE_SCHEMA_OPTIONS = {
  strict: 'throw' as const,
  versionKey: false as const,
};

export const INTEGER_VALIDATOR = {
  validator: (value: unknown): boolean =>
    typeof value === 'number' && Number.isInteger(value),
  message: '{PATH} must be an integer.',
};

export function createSensitiveTransform(sensitiveFields: readonly string[]) {
  return (_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> => {
    for (const field of sensitiveFields) {
      delete ret[field];
    }
    return ret;
  };
}

export function getOrCreateModel<T>(
  modelName: string,
  schema: Schema<T>,
): Model<T> {
  const existing = mongoose.models[modelName] as Model<T> | undefined;
  if (existing) {
    return existing;
  }

  return mongoose.model<T>(modelName, schema);
}

