import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import type { DashboardContext } from '../App'
import { api } from '../api'
import { DevicePanel } from '../components/DevicePanel'
import { springTransition } from '../components/motion'

/** The devices view: connect, demo-connect, and disconnect wearables. */
export function DevicesPage() {
  const { user, mode, devices, refreshDevices, setError } =
    useOutletContext<DashboardContext>()
  // Set after a demo connect succeeds, so the path back to the data the user
  // just unlocked is one click instead of a nav hunt.
  const [demoConnected, setDemoConnected] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springTransition}
    >
      <DevicePanel
        devices={devices}
        environment={mode}
        onConnect={async (provider) => {
          setError(null)
          try {
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
        onConnectDemo={async (provider) => {
          setError(null)
          try {
            await api.connectDemo(user.id, provider)
            await refreshDevices()
            setDemoConnected(true)
          } catch (e) {
            setError(String(e))
          }
        }}
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
      <AnimatePresence initial={false}>
        {demoConnected && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={springTransition}
            className="mt-3 text-sm text-muted-foreground"
          >
            Demo data is on its way.{' '}
            <Link
              to="/metrics/heartrate"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              View your timeline
            </Link>
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
