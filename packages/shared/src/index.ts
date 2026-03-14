import { z, ZodType } from 'zod'

export * from './api'

export const Session = z.object({
  id: z.string(),
  datasetName: z.string(),
  frameIndex: z.number(),
  prevDataStr: z.string(),
  controlStr: z.string(),
})
export type Session = z.infer<typeof Session>

export const SessionId = z.object({
  id: z.string()
})

export const Dataset = z.object({
  name: z.string(),
  size: z.number(),
  ext: z.string(),
})
export type Dataset = z.infer<typeof Dataset>

export const Success = <T>(value: ZodType<T>) => z.object({
  status: z.literal('success'),
  value,
})

export const Failure = <E>(reason: ZodType<E>) => z.object({
  status: z.literal('failure'),
  reason,
})

export const Result = <T, E>(success: ZodType<T>, failure: ZodType<E>) => z.union([
  Success(success),
  Failure(failure),
])

export const Empty = z.object({})
