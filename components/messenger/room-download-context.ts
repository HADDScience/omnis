"use client"

// 「모두 저장」(한 글에 여러 사진 · 파일) 이 받을 방 — 서랍이 있는 방(전사 · 사람 방)에서만 값이 있다. message-list 의 MessageFiles 가 읽는다
import { createContext, useContext } from "react"

export const RoomDownloadContext = createContext<{ roomId: string; roomName: string } | null>(null)

export const useRoomDownload = () => useContext(RoomDownloadContext)
