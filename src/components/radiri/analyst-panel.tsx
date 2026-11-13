"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalystResponse, CompareResponse } from "@/lib/radiri/types";
import { postAnalyst } from "./api";
import { EmptyNote, ErrorNote } from "./bits";
import { formatIso, shortHash, toMessage } from "./format";

export function AnalystPanel({
  compare,
  loading,
}: {
  compare: CompareResponse | null;
  loading: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<AnalystResponse | null>(null);
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    return () => {
      seq.current += 1;
    };
  }, []);

  async function ask() {
    if (!compare) return;
    const ticket = (seq.current += 1);
    setPending(true);
    setError(null);
    try {
      const data = await postAnalyst({ compare, question: question.trim() || undefined });
      if (seq.current !== ticket) return;
      setReply(data);
      setAnsweredFor(compare.generatedAt);
    } catch (caught) {
      if (seq.current !== ticket) return;
      setError(toMessage(caught));
    } finally {
      if (seq.current === ticket) setPending(false);
    }
  }

  const stale = Boolean(reply && compare && answeredFor !== compare.generatedAt);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-1.5">
        <Input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Optional question about these routes"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void ask();
            }
          }}
          disabled={!compare || pending}
          className="h-7 text-xs"
          aria-label="Question for the analyst"
        />
        <Button size="sm" onClick={() => void ask()} disabled={!compare || loading || pending}>
          <Sparkles aria-hidden />
          {pending ? "Analysing" : "Explain"}
        </Button>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {pending && !reply ? (
        <div className="flex flex-col gap-1.5" aria-busy>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-9/12" />
          <p className="text-[0.7rem] text-muted-foreground">Asking NEAR AI Cloud for an explanation.</p>
        </div>
      ) : null}

      {reply ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[0.7rem] text-muted-foreground">
            <Badge variant="outline" className="font-mono text-[0.65rem]">
              {reply.model}
            </Badge>
            <span>answered {answeredFor ? formatIso(answeredFor) : "just now"}</span>
            {reply.verification?.verifyUrl ? (
              <a
                href={reply.verification.verifyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
              >
                verify
                <ExternalLink className="size-2.5" aria-hidden />
              </a>
            ) : null}
          </div>
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{reply.text}</p>
          {reply.verification ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t pt-1.5 font-mono text-[0.65rem] text-muted-foreground">
              {reply.verification.chatId ? (
                <>
                  <dt>chat</dt>
                  <dd className="truncate">{reply.verification.chatId}</dd>
                </>
              ) : null}
              {reply.verification.signingAddress ? (
                <>
                  <dt>signer</dt>
                  <dd className="truncate">{reply.verification.signingAddress}</dd>
                </>
              ) : null}
              {reply.verification.signature ? (
                <>
                  <dt>sig</dt>
                  <dd className="truncate" title={reply.verification.signature}>
                    {shortHash(reply.verification.signature)}
                  </dd>
                </>
              ) : null}
            </dl>
          ) : (
            <EmptyNote>No verification material returned with this reply.</EmptyNote>
          )}
          {stale ? (
            <p className="text-[0.7rem] text-amber-600 dark:text-amber-400">
              This answer refers to an earlier quote. Ask again to refresh it.
            </p>
          ) : null}
        </div>
      ) : null}

      {!reply && !pending && !error ? (
        <EmptyNote>
          {compare
            ? "No analyst reply yet. It reads the compare result above and explains the spread."
            : "Waiting for the first quote before asking the analyst."}
        </EmptyNote>
      ) : null}
    </div>
  );
}
