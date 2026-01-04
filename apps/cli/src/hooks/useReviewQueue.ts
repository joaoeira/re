import { useReducer, useEffect, useRef } from "react"
import { Effect, Fiber, Exit } from "effect"
import {
  ReviewQueueService,
  AppLive,
  type Selection,
  type ReviewQueue,
  type DeckTreeNode,
} from "../services"

export interface UseReviewQueueResult {
  loading: boolean
  error: string | null
  queue: ReviewQueue | null
}

interface QueueState {
  loading: boolean
  error: string | null
  queue: ReviewQueue | null
}

type QueueAction =
  | { type: "SET_LOADING" }
  | { type: "SET_SUCCESS"; payload: ReviewQueue }
  | { type: "SET_ERROR"; payload: string }
  | { type: "RESET" }

function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: true, error: null }
    case "SET_SUCCESS":
      return { queue: action.payload, error: null, loading: false }
    case "SET_ERROR":
      return { queue: null, error: action.payload, loading: false }
    case "RESET":
      return { queue: null, error: null, loading: false }
    default:
      return state
  }
}

const initialState: QueueState = {
  loading: false,
  error: null,
  queue: null,
}

export function useReviewQueue(
  selection: Selection | null,
  tree: readonly DeckTreeNode[],
  rootPath: string
): UseReviewQueueResult {
  const [state, dispatch] = useReducer(queueReducer, initialState)
  const fiberRef = useRef<Fiber.RuntimeFiber<ReviewQueue, never> | null>(null)

  useEffect(() => {
    // Reset when selection is cleared
    if (!selection) {
      dispatch({ type: "RESET" })
      return
    }

    // Don't build queue if tree is empty
    if (tree.length === 0) {
      dispatch({ type: "RESET" })
      return
    }

    let cancelled = false

    dispatch({ type: "SET_LOADING" })

    const program = Effect.gen(function* () {
      const queueService = yield* ReviewQueueService
      const now = new Date()
      return yield* queueService.buildQueue(selection, tree, rootPath, now)
    }).pipe(Effect.provide(AppLive))

    const fiber = Effect.runFork(program)
    fiberRef.current = fiber

    Effect.runPromise(Fiber.await(fiber)).then((exit) => {
      if (cancelled) return

      if (Exit.isSuccess(exit)) {
        dispatch({ type: "SET_SUCCESS", payload: exit.value })
      } else if (Exit.isFailure(exit)) {
        if (!Exit.isInterrupted(exit)) {
          dispatch({ type: "SET_ERROR", payload: String(exit.cause) })
        }
      }
    })

    return () => {
      cancelled = true
      if (fiberRef.current) {
        Effect.runFork(Fiber.interrupt(fiberRef.current))
      }
    }
  }, [selection, tree, rootPath])

  return { loading: state.loading, error: state.error, queue: state.queue }
}
