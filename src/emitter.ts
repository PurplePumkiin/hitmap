export type Emitter<M> = {
  on<K extends keyof M>(type: K, fn: (e: M[K]) => void): () => void;
  emit<K extends keyof M>(type: K, payload: M[K]): void;
  clear(): void;
};

export function createEmitter<M>(): Emitter<M> {
  const map = new Map<keyof M, Set<(e: any) => void>>();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(fn);
      return () => {
        map.get(type)?.delete(fn);
      };
    },
    emit(type, payload) {
      map.get(type)?.forEach((fn) => fn(payload));
    },
    clear() {
      map.clear();
    },
  };
}
