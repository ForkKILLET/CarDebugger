import path from 'path'
import fs from 'fs'
import fsp from 'fs/promises'

import Fastify from 'fastify'
import cors from '@fastify/cors'
import { type ZodTypeProvider, validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod'

import { pino } from 'pino'
import { execa, ExecaError } from 'execa'

import { CompileReq, CompileRes, CreateSessionReq, CreateSessionRes, DatasetListRes, DeleteSessionReq, DeleteSessionRes, ELEMENT_DISPLAY, RunFrameReq, RunFrameRes, Session, SetElementReq, SetElementRes } from '@car-debugger/shared'
import { z } from 'zod'

const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
})

function panic(msg: string, ...args: any[]): never {
  logger.error(msg, ...args)
  process.exit(1)
}

class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Session ${id} not found`)
  }
}

export const fastify = Fastify({
  loggerInstance: logger,
})
  .register(cors)
  .setValidatorCompiler(validatorCompiler)
  .setSerializerCompiler(serializerCompiler)
  .setErrorHandler((err, _req, res) => {
    if (err instanceof SessionNotFoundError) {
      res.status(403)
      return {
        error: err.message,
      }
    }
    return err
  })
  .withTypeProvider<ZodTypeProvider>()

const configFilePath = path.join(process.cwd(), '../../config.json')

const zConfig = z.object({
  backend: z.object({
    testDir: z.string(),
  })
})

const loadConfig = () => {
  try {
    const { backend: backendConfig } = zConfig.parse(JSON.parse(fs.readFileSync(configFilePath, 'utf-8')))
    return backendConfig
  }
  catch (err) {
    panic('Failed to load config: %o', err)
  }
}
const config = loadConfig()

const executablePath = path.join(config.testDir, 'image_test.out')
const datasetPath = path.join(config.testDir, 'data')
const datasetArrayPath = path.join(datasetPath, 'array')

const runSession = async (session: Session) => {
  const { frameIndex, prevDataStr, controlStr } = session
  const { stdout, stderr } = await execa(
    executablePath,
    [
      `${datasetArrayPath}/${session.datasetName}_${frameIndex}.dat`,
      prevDataStr,
      controlStr,
    ],
  )
  return { stdout, stderr }
}

const sessions = new Map<string, Session>()

const getDatasetList = async (): Promise<DatasetListRes> =>
  JSON.parse(await fsp.readFile(path.join(datasetPath, 'index.json'), 'utf-8'))

fastify.get('/dataset-list', {
  schema: {
    response: {
      200: DatasetListRes
    }
  }
}, getDatasetList)

fastify.get('/list-session', () => Object.fromEntries(sessions.entries()))

fastify.get('/dataset-image/:datasetName/:frameIndex', {
  schema: {
    params: z.object({
      datasetName: z.string(),
      frameIndex: z.string(),
    })
  }
}, async (req, res) => {
  const { datasetName, frameIndex } = req.params
  const datasetList = await getDatasetList()
  const dataset = datasetList.find(({ name }) => name === datasetName)
  if (! dataset) {
    return res.status(404)
  }
  const imagePath = path.join(datasetPath, 'images', `${datasetName}_${frameIndex}.${dataset.ext}`)
  const imageStream = fs.createReadStream(imagePath)
  return res
    .type('image/jpeg')
    .send(imageStream)
})

fastify.post('/compile', {
  schema: {
    body: CompileReq,
    response: {
      200: CompileRes
    }
  }
}, async () => {
  try {
    await execa(path.join(config.testDir, 'compile.sh'), {
      cwd: config.testDir,
    })
    return {
      status: 'success' as const
    }
  }
  catch (err) {
    const { stderr } = err as ExecaError
    return {
      status: 'failure' as const,
      reason: stderr as string,
    }
  }
})

fastify.post('/create-session', {
  schema: {
    body: CreateSessionReq,
    response: {
      200: CreateSessionRes,
    }
  }
}, async (req) => {
  const { datasetName } = req.body
  const id = crypto.randomUUID()
  const session: Session = {
    id,
    datasetName,
    frameIndex: 1,
    prevDataStr: '',
    controlStr: '',
  }

  sessions.set(id, session)

  return session
})

fastify.post('/delete-session', {
  schema: {
    body: DeleteSessionReq,
    response: {
      200: DeleteSessionRes,
    }
  }
}, async (req) => {
  const { id } = req.body
  const session = sessions.get(id)
  if (! session) throw new SessionNotFoundError(id)

  sessions.delete(id)

  return {
    status: 'success' as const,
  }
})

fastify.post('/run-frame', {
  schema: {
    body: RunFrameReq,
    response: {
      200: RunFrameRes,
    }
  }
}, async (req) => {
  const { id, frameIndex } = req.body
  const session = sessions.get(id)
  if (! session) throw new SessionNotFoundError(id)
  if (frameIndex !== undefined) {
    session.frameIndex = frameIndex
  }

  try {
    await fsp.stat(executablePath)
  }
  catch {
    return {
      status: 'failure' as const,
      reason: 'Executable not found'
    }
  }

  try {
    const result = await runSession(session)
    session.prevDataStr = result.stderr
    return {
      status: 'success' as const,
      value: result
    }
  }
  catch (err) {
    const { stderr } = err as ExecaError
    return {
      status: 'failure' as const,
      reason: stderr as string,
    }
  }
})

fastify.post('/set-element', {
  schema: {
    body: SetElementReq,
    response: {
      200: SetElementRes,
    }
  }
}, async (req) => {
  const { id, element } = req.body
  const session = sessions.get(id)
  if (! session) throw new SessionNotFoundError(id)

  const elementId = ELEMENT_DISPLAY.indexOf(element)
  session.prevDataStr = session.prevDataStr
    .replace(/\[element = \d+ \(\w+\)\]/, `[element = ${elementId} (${element})]`)
  
  return { status: 'success' as const }
})

if (import.meta.env.PROD) {
  fastify.listen({
    port: 1660
  })
}
