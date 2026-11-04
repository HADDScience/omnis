"use client"

// 메신저 셸(messenger-shell.tsx)이 안쪽 화면에 내려 주는 값 — 셸과 목록 · 입장 화면이 서로 import 하며 돌지 않게 따로 둔다

import { createContext, useContext } from "react"

/** 방 화면이 목록을 다시 읽게 할 때 — 새 대화를 만들었거나 답을 받아 순서가 바뀌었을 때 */
export const RoomListReload = createContext<() => void>(() => {})
export const useRoomListReload = () => useContext(RoomListReload)

/** 메신저를 보는 사람 — 기기 저장(lib/chat-cache.ts)의 키. 메신저 밖(오른쪽 패널)에서는 빈 값이라 저장하지 않는다 */
export const ChatUser = createContext<string>("")
export const useChatUserId = () => useContext(ChatUser)

/** 목록에서 방을 누른 순간 — 셸이 그 방의 입장 화면(머리 · 입력창)을 바로 그린다. null 이면 걷는다(입장 화면의 ← ) */
export const StartRoomEntry = createContext<(key: string | null) => void>(() => {})
export const useStartRoomEntry = () => useContext(StartRoomEntry)

/** 방 화면(또는 그 loading 화면)이 그려졌다 — 셸이 덮어 둔 입장 화면을 걷는다. 메신저 밖에서는 아무 일도 없다 */
export const RoomSurfaceReady = createContext<(key: string) => void>(() => {})
export const useRoomSurfaceReady = () => useContext(RoomSurfaceReady)
