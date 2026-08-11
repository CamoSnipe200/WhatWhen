import type { WhatWhenApi } from './index'

declare global {
  interface Window {
    whatwhen: WhatWhenApi
  }
}

export {}
