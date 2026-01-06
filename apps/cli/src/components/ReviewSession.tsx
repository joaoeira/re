import { useMachine } from "@xstate/react"
import { useKeyboard } from "@opentui/react"
import { useEffect, useState, useRef, useCallback } from "react"
import { Effect, Exit, Layer, Runtime, Scope } from "effect"
import { BunFileSystem } from "@effect/platform-bun"
import { reviewSessionMachine } from "../machines/reviewSession"
import { CardRenderer } from "./CardRenderer"
import { GradeButtons } from "./GradeButtons"
import { SessionSummary } from "./SessionSummary"
import { Header, Footer, Panel, ErrorDisplay } from "./ui"
import { getCardSpec } from "../lib/getCardSpec"
import { themeColors as theme } from "../ThemeContext"
import type { QueueItem } from "../services/ReviewQueue"
import type { CardSpec, Grade } from "@re/core"
import { Scheduler, SchedulerLive } from "../services/Scheduler"
import { DeckWriter, DeckWriterLive } from "../services/DeckWriter"
import { Loading } from "./Spinner"

interface ReviewSessionProps {
  queue: readonly QueueItem[]
  onComplete: () => void
  onQuit: () => void
}

const ReviewSessionLayer = Layer.mergeAll(SchedulerLive, DeckWriterLive).pipe(
  Layer.provide(BunFileSystem.layer)
)

function useReviewSessionRuntime() {
  const [runtime, setRuntime] = useState<Runtime.Runtime<
    Scheduler | DeckWriter
  > | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const closeRef = useRef<Effect.Effect<void> | null>(null)

  useEffect(() => {
    let cancelled = false

    // Layer.toRuntime requires a Scope, so we create and manage one manually
    const program = Effect.gen(function* () {
      const scope = yield* Scope.make()
      const runtime = yield* Layer.toRuntime(ReviewSessionLayer).pipe(
        Scope.extend(scope)
      )
      const close = Scope.close(scope, Exit.void)
      return { runtime, close }
    })

    Effect.runPromise(program)
      .then(({ runtime, close }) => {
        if (cancelled) {
          Effect.runFork(close)
          return
        }
        closeRef.current = close
        setRuntime(runtime)
      })
      .catch((error) => {
        if (cancelled) return
        setRuntimeError(String(error))
      })

    return () => {
      cancelled = true
      if (closeRef.current) {
        Effect.runFork(closeRef.current)
        closeRef.current = null
      }
    }
  }, [])

  return { runtime, runtimeError }
}

export function ReviewSession({
  queue,
  onComplete,
  onQuit,
}: ReviewSessionProps) {
  const { runtime, runtimeError } = useReviewSessionRuntime()

  useKeyboard((key) => {
    if (!runtime || runtimeError) {
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        onQuit()
      }
    }
  })

  if (runtimeError) {
    return (
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
      >
        <Header title="Review" />
        <ErrorDisplay
          title="Failed to initialize review session"
          message={runtimeError}
        />
        <Footer bindings={[{ keys: "q", action: "quit" }]} />
      </box>
    )
  }

  if (!runtime) {
    return (
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
      >
        <Header title="Review" />
        <Loading message="Initializing..." />
      </box>
    )
  }

  return (
    <ReviewSessionInner
      queue={queue}
      runtime={runtime}
      onComplete={onComplete}
      onQuit={onQuit}
    />
  )
}

function ReviewSessionInner({
  queue,
  runtime,
  onComplete,
  onQuit,
}: ReviewSessionProps & { runtime: Runtime.Runtime<Scheduler | DeckWriter> }) {
  const [state, send] = useMachine(reviewSessionMachine, {
    input: { queue, runtime },
  })

  const [cardSpec, setCardSpec] = useState<CardSpec<Grade> | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)

  const currentIndex = state.context.currentIndex
  const currentItem = queue[currentIndex]

  useEffect(() => {
    setCardSpec(null)
    setCardError(null)

    if (!currentItem) return

    let cancelled = false

    Effect.runPromise(getCardSpec(currentItem))
      .then((spec) => {
        if (!cancelled) setCardSpec(spec)
      })
      .catch((e) => {
        if (!cancelled) setCardError(e.message)
      })

    return () => {
      cancelled = true
    }
  }, [currentIndex, currentItem])

  const skipCard = useCallback(() => {
    send({ type: "SKIP" })
  }, [send])

  useEffect(() => {
    send({ type: "START" })
  }, [send])

  const isGrading = state.matches({ presenting: "grading" })

  useKeyboard((key) => {
    if (isGrading) return

    if (cardError) {
      if (key.name === "s" || key.name === "space") {
        skipCard()
        return
      }
    }

    if (state.matches({ presenting: "showPrompt" })) {
      if (key.name === "space" || key.name === "return") {
        send({ type: "REVEAL" })
      }
    } else if (state.matches({ presenting: "showAnswer" })) {
      if (key.name === "1") send({ type: "GRADE", grade: 0 })
      if (key.name === "2") send({ type: "GRADE", grade: 1 })
      if (key.name === "3") send({ type: "GRADE", grade: 2 })
      if (key.name === "4") send({ type: "GRADE", grade: 3 })
    }

    if (key.name === "u" && state.can({ type: "UNDO" })) {
      send({ type: "UNDO" })
    }

    if (key.name === "q" && state.can({ type: "QUIT" })) {
      send({ type: "QUIT" })
      onQuit()
    }
  })

  if (state.matches("complete")) {
    return (
      <SessionSummary
        stats={state.context.sessionStats}
        canUndo={state.context.reviewLogStack.length > 0}
        onUndo={() => send({ type: "UNDO" })}
        onDone={onComplete}
      />
    )
  }

  if (cardError) {
    return (
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
      >
        <Header
          title="Review"
          subtitle={`${currentIndex + 1}/${queue.length}`}
        />
        <ErrorDisplay
          title="Card parse error"
          message={`${cardError}\n\nDeck: ${currentItem?.deckName ?? "unknown"}`}
        />
        <box marginTop={1}>
          <text fg={theme.textMuted}>
            This card will be skipped. You can review it after fixing the
            content.
          </text>
        </box>
        <Footer
          bindings={[
            { keys: "s/space", action: "skip" },
            { keys: "q", action: "quit" },
          ]}
        />
      </box>
    )
  }

  if (!currentItem || !cardSpec) {
    return (
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
      >
        <Header title="Review" />
        <Loading message="Loading card..." />
      </box>
    )
  }

  const progress = `${state.context.currentIndex + 1}/${queue.length}`
  const isRevealed = state.context.isRevealed

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1}>
      <Header title="Review" subtitle={progress} />

      {state.context.error && (
        <ErrorDisplay title="Error" message={state.context.error} />
      )}

      <CardRenderer
        queueItem={currentItem}
        cardSpec={cardSpec}
        isRevealed={isRevealed}
      />

      {isRevealed && (
        <box marginTop={1}>
          <GradeButtons onGrade={(grade) => send({ type: "GRADE", grade })} />
        </box>
      )}

      <box marginTop={2}>
        <Footer
          bindings={[
            ...(isRevealed
              ? [
                  { keys: "1", action: "again" },
                  { keys: "2", action: "hard" },
                  { keys: "3", action: "good" },
                  { keys: "4", action: "easy" },
                ]
              : [{ keys: "space", action: "reveal" }]),
            ...(state.context.reviewLogStack.length > 0
              ? [{ keys: "u", action: "undo" }]
              : []),
            { keys: "q", action: "quit" },
          ]}
        />
      </box>
    </box>
  )
}
