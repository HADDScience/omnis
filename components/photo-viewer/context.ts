"use client"

// 채팅의 사진을 누르면 뷰어로 — message-list 의 MessageFiles 가 부른다. 뷰어가 없는 화면(업무 스레드 등)은 null 이라 새 탭으로 연다
import { createContext, useContext } from "react"

export const PhotoViewerContext = createContext<{ open: (messageId: string, fileId: string) => void } | null>(null)

export const usePhotoViewer = () => useContext(PhotoViewerContext)
