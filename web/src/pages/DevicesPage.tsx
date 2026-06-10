import { motion } from 'motion/react'
import { useOutletContext } from 'react-router-dom'
import type { DashboardContext } from '../App'
import { api } from '../api'
import { DevicePanel } from '../components/DevicePanel'
import { springTransition } from '../components/motion'

/** The devices view: connect, demo-connect, and disconnect wearables. */
export function DevicesPage() {
  const { user, mode, devices, refreshDevices, setError } =
    useOutletContext<DashboardContext>()

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
            window.open(link_url, '_blank')
          } catch (e) {
            setError(String(e))
          }
        }}
        onConnectDemo={async (provider) => {
          setError(null)
          try {
            await api.connectDemo(user.id, provider)
            await refreshDevices()
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
    </motion.div>
  )
}
