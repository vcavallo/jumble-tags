import { usePrimaryPage } from '@/PageManager'
import { TagSimpleIcon } from '@phosphor-icons/react'
import SidebarItem from './SidebarItem'

export default function TagsButton({ collapse }: { collapse: boolean }) {
  const { navigate, current, display } = usePrimaryPage()
  const active = current === 'tags' && display

  return (
    <SidebarItem title="Tags" onClick={() => navigate('tags')} active={active} collapse={collapse}>
      <TagSimpleIcon weight={active ? 'fill' : 'bold'} />
    </SidebarItem>
  )
}
