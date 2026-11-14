"use client";

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { ChakraProvider } from "@chakra-ui/react";
import { useServerInsertedHTML } from "next/navigation";
import { useState } from "react";
import { system } from "@/theme/system";

/**
 * Collects the Emotion styles Chakra generates while a page renders on the server and emits them
 * in <head> through useServerInsertedHTML, so the server HTML matches what the client hydrates.
 */
function EmotionRegistry({ children }: { children: React.ReactNode }) {
  const [registry] = useState(() => {
    const cache = createCache({ key: "chakra" });
    cache.compat = true;
    const insert = cache.insert;
    let inserted: { name: string; isGlobal: boolean }[] = [];
    cache.insert = (...args) => {
      const [selector, serialized] = args;
      if (cache.inserted[serialized.name] === undefined) inserted.push({ name: serialized.name, isGlobal: !selector });
      return insert(...args);
    };
    const flush = () => {
      const flushed = inserted;
      inserted = [];
      return flushed;
    };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const inserted = registry.flush();
    if (inserted.length === 0) return null;
    let styles = "";
    let attribute = registry.cache.key;
    const globals: { name: string; style: string }[] = [];
    for (const { name, isGlobal } of inserted) {
      const style = registry.cache.inserted[name];
      if (typeof style !== "string") continue;
      if (isGlobal) {
        globals.push({ name, style });
      } else {
        styles += style;
        attribute += ` ${name}`;
      }
    }
    return (
      <>
        {globals.map(({ name, style }) => (
          <style key={name} data-emotion={`${registry.cache.key}-global ${name}`} dangerouslySetInnerHTML={{ __html: style }} />
        ))}
        {styles ? <style data-emotion={attribute} dangerouslySetInnerHTML={{ __html: styles }} /> : null}
      </>
    );
  });

  return <CacheProvider value={registry.cache}>{children}</CacheProvider>;
}

/** Chakra UI for the app pages (Overview, Borrow, Swap, Portfolio, Markets, Activity). */
export function ChakraUIProvider({ children }: { children: React.ReactNode }) {
  return (
    <EmotionRegistry>
      <ChakraProvider value={system}>{children}</ChakraProvider>
    </EmotionRegistry>
  );
}
