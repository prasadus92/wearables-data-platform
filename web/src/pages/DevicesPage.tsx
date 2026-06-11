import { motion } from 'motion/react'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { DashboardContext } from '../App'
import { api } from '../api'
import { DevicePanel } from '../components/DevicePanel'
import { springTransition, TapButton } from '../components/motion'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** The devices view: connect, demo-connect, and disconnect wearables. */
export function DevicesPage() {
  const { user, mode, devices, refreshDevices, setError } =
    useOutletContext<DashboardContext>()
  // Apple Watch pairs through a single-use code in the Vital Connect app;
  // the dialog walks the three steps and shows the freshly minted code.
  const [appleCode, setAppleCode] = useState<
    { state: 'closed' } | { state: 'loading' } | { state: 'ready'; code: string } | { state: 'failed' }
  >({ state: 'closed' })
  const mintAppleCode = async () => {
    setAppleCode({ state: 'loading' })
    try {
      if (mode === 'sandbox') {
        // Demo mode attaches the demo Apple Watch directly, like any
        // other demo wearable.
        await api.connectDemo(user.id, 'apple_health_kit')
        await refreshDevices()
        setAppleCode({ state: 'closed' })
        return
      }
      const { code } = await api.applePairingCode(user.id)
      setAppleCode({ state: 'ready', code })
    } catch {
      setAppleCode({ state: 'failed' })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springTransition}
    >
      <DevicePanel
        devices={devices}
        onConnect={async (provider) => {
          setError(null)
          try {
            // Demo mode attaches demo wearables instantly; hosted OAuth is
            // for real accounts. WHOOP and Garmin have no demo data, so
            // they keep the OAuth path in both modes.
            if (mode === 'sandbox' && (provider === 'oura' || provider === 'fitbit')) {
              await api.connectDemo(user.id, provider)
              await refreshDevices()
              return
            }
            const { link_url } = await api.createLink(user.id, provider)
            // Popup blockers return null without throwing; falling back to
            // this tab keeps the flow alive (the link redirects back here
            // when it finishes) instead of silently doing nothing.
            const popup = window.open(link_url, '_blank')
            if (!popup) window.location.assign(link_url)
          } catch (e) {
            setError(String(e))
          }
        }}
        onConnectApple={mintAppleCode}
        onDisconnect={async (provider) => {
          setError(null)
          try {
            await api.disconnect(user.id, provider)
            await refreshDevices()
          } catch (e) {
            setError(String(e))
          }
        }}
      />
      <Dialog
        open={appleCode.state !== 'closed'}
        onOpenChange={(open: boolean) => {
          if (!open) setAppleCode({ state: 'closed' })
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect your Apple Watch</DialogTitle>
            <DialogDescription>
              Apple Watch readings flow through the Health app on the paired
              iPhone, so the connection happens there.
            </DialogDescription>
          </DialogHeader>
          {appleCode.state === 'loading' && (
            <p className="text-sm text-muted-foreground">Creating your pairing code…</p>
          )}
          {appleCode.state === 'failed' && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                Could not create a pairing code. Try again.
              </p>
              <TapButton size="sm" onClick={mintAppleCode}>
                Retry
              </TapButton>
            </div>
          )}
          {appleCode.state === 'ready' && (
            <div className="flex flex-col gap-4">
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground">
                <li>
                  Install the <span className="font-medium text-foreground">Vital Connect</span>{' '}
                  app from the App Store on the iPhone paired with the watch.
                </li>
                <li>Enter this code in the app:</li>
              </ol>
              <button
                type="button"
                className="cursor-pointer rounded-xl border bg-muted/50 py-4 text-center font-mono text-3xl tracking-[0.3em] select-all"
                title="Click to copy"
                onClick={() => navigator.clipboard?.writeText(appleCode.code)}
              >
                {appleCode.code}
              </button>
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-muted-foreground" start={3}>
                <li>
                  Grant Health access when asked. Readings appear on your timeline within
                  minutes.
                </li>
              </ol>
              <p className="text-xs text-muted-foreground">
                The code is single use and expires quickly; mint a fresh one any time.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
