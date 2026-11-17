"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { GoalComment, PersonSummary } from "@/app/types";
import { cn } from "@/lib/utils";
import { initials } from "./goal-utils";

const MAX_BODY = 5000;
const MENTION_TOKEN = /@\[([^\]\s]+)\]/g;

function timestamp(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Renders stored `@[userId]` tokens as highlighted names. */
function CommentBody({ body, names }: { body: string; names: Map<string, string> }) {
  const parts = body.split(MENTION_TOKEN);
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {parts.map((part, index) => index % 2 === 1
        ? <span key={index} className="font-medium text-brand-teal">@{names.get(part) ?? "someone"}</span>
        : <Fragment key={index}>{part}</Fragment>)}
    </p>
  );
}

/**
 * Discussion on a goal. Typing `@` suggests only people who can already see the goal (the server
 * enforces the same rule), and the chosen names are sent as `@[id]` tokens so emails stay private.
 */
export function GoalComments({ objectiveId }: { objectiveId: string }) {
  const [comments, setComments] = useState<GoalComment[]>([]);
  const [mentionable, setMentionable] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<PersonSummary[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/comments?objectiveId=${encodeURIComponent(objectiveId)}`, { cache: "no-store" }).catch(() => null);
    setLoading(false);
    if (!response?.ok) {
      setMessage({ tone: "error", text: "Comments could not be loaded." });
      return;
    }
    const data = await response.json();
    setComments(data.comments ?? []);
    setMentionable(data.mentionable ?? []);
  }, [objectiveId]);

  useEffect(() => {
    void load();
  }, [load]);

  const names = useMemo(() => {
    const map = new Map(mentionable.map((person) => [person.id, person.name]));
    for (const comment of comments) {
      map.set(comment.authorId, comment.authorName);
      for (const mention of comment.mentions) map.set(mention.id, mention.name);
    }
    return map;
  }, [comments, mentionable]);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return mentionable.filter((person) => person.name.toLowerCase().includes(needle)).slice(0, 6);
  }, [mentionable, query]);

  function onChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setText(value);
    const beforeCaret = value.slice(0, event.target.selectionStart ?? value.length);
    const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(beforeCaret);
    setQuery(match ? match[1] : null);
    setActive(0);
  }

  function choose(person: PersonSummary) {
    const element = textareaRef.current;
    const caret = element?.selectionStart ?? text.length;
    const start = text.slice(0, caret).lastIndexOf("@");
    if (start < 0) return;
    const next = `${text.slice(0, start)}@${person.name} ${text.slice(caret)}`;
    setText(next);
    setPicked((current) => (current.some((entry) => entry.id === person.id) ? current : [...current, person]));
    setQuery(null);
    requestAnimationFrame(() => {
      const position = start + person.name.length + 2;
      element?.focus();
      element?.setSelectionRange(position, position);
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((current) => (current + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(suggestions[active]);
        return;
      }
      if (event.key === "Escape") {
        // Close the suggestions without closing the goal panel.
        event.preventDefault();
        event.stopPropagation();
        setQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void post();
    }
  }

  async function post() {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    // Longest names first so "@Ann Lee" is not swallowed by "@Ann".
    let body = trimmed;
    for (const person of [...picked].sort((left, right) => right.name.length - left.name.length)) {
      body = body.replaceAll(`@${person.name}`, `@[${person.id}]`);
    }
    setPosting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectiveId, body }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: data.error ?? "The comment could not be posted." });
        return;
      }
      setText("");
      setPicked([]);
      setComments((current) => [...current, data.comment]);
      if (data.notified) setMessage({ tone: "info", text: `Notified ${data.notified} ${data.notified === 1 ? "person" : "people"}.` });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-4">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading comments…</p>
      ) : comments.length ? (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold" aria-hidden="true">{initials(comment.authorName)}</span>
              <div className="min-w-0 flex-1 rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted-foreground"><span className="font-semibold text-foreground">{comment.authorName}</span> · {timestamp(comment.createdAt)}</p>
                <CommentBody body={comment.body} names={names} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>
      )}

      <div className="relative space-y-2">
        <Label htmlFor={`comment-${objectiveId}`}>Add a comment</Label>
        <Textarea
          id={`comment-${objectiveId}`}
          ref={textareaRef}
          value={text}
          maxLength={MAX_BODY}
          placeholder="Share an update. Type @ to mention someone who can see this goal."
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={() => window.setTimeout(() => setQuery(null), 150)}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={`comment-${objectiveId}-mentions`}
          aria-autocomplete="list"
          aria-activedescendant={suggestions.length ? `comment-${objectiveId}-mention-${suggestions[active]?.id}` : undefined}
        />
        {suggestions.length > 0 && (
          <ul id={`comment-${objectiveId}-mentions`} role="listbox" aria-label="People who can see this goal" className="absolute inset-x-0 z-10 max-h-56 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {suggestions.map((person, index) => (
              <li
                key={person.id}
                id={`comment-${objectiveId}-mention-${person.id}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => { event.preventDefault(); choose(person); }}
                className={cn("flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm", index === active && "bg-accent")}
              >
                <span className="truncate">{person.name}</span>
                {person.jobTitle && <span className="truncate text-xs text-muted-foreground">{person.jobTitle}</span>}
              </li>
            ))}
          </ul>
        )}
        {query !== null && !suggestions.length && mentionable.length > 0 && (
          <p className="text-xs text-muted-foreground">No one who can see this goal matches “{query}”.</p>
        )}
        {message && <p role={message.tone === "error" ? "alert" : "status"} className={cn("text-xs", message.tone === "error" ? "text-destructive" : "text-muted-foreground")}>{message.text}</p>}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Ctrl/⌘ + Enter to post</p>
          <Button type="button" size="sm" onClick={() => void post()} disabled={posting || !text.trim()}>
            {posting ? "Posting…" : "Post comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
