// 앞의 일이 끝난 뒤에 다음 일을 시작한다 — 시험: lib/serial-queue.test.ts
//
// 사진을 올리는 동안 다음 글을 보내도 서버에는 쓴 순서대로 닿아야 한다. 글마다 따로 보내면 글이 사진을 앞지른다.
// 앞의 일이 실패해도 뒤의 일은 그대로 돈다. 실패는 그 일을 맡긴 쪽이 돌려받는다.

export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task)
      tail = result.catch(() => undefined)
      return result
    },
  }
}
