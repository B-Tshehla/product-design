<script setup lang="ts">
import { computed } from 'vue'
import {
  Shield, ShieldCheck, ShieldAlert,
  Zap, Package, Search, FileText, Settings, Rocket,
  AlertTriangle, AlertCircle,
  CheckCircle2, XCircle, CircleCheck, CircleX, CircleAlert, Circle,
  BarChart3, Link2, Lightbulb,
  FolderOpen, User, Users, ClipboardList, ClipboardCheck,
  Target, RefreshCw, TrendingUp, TrendingDown,
  Wrench, PenLine, Tag, Building2, TestTube2,
  Database, Server, Lock, Globe, Code, Code2, GitBranch, Layers,
  ArrowRight, ChevronRight, ChevronDown, ExternalLink,
  Info, BookOpen, Terminal, Cpu,
  Network, HardDrive, Key, Eye, EyeOff,
  Activity, Bug, Clock,
  FileCode, Filter, Box, Layout, Blocks,
  Play, Puzzle, Map, Gauge,
  Workflow, Binary, Container, MonitorCheck,
  ScanLine, Sparkles, CircleDot,
  Cog, Heart, Star, Hash, List, ListChecks,
  AlertOctagon, Ban, ThumbsUp, ThumbsDown,
  Download, Upload, Share2, Bookmark,
  MessageSquare, Bell, Mail,
  Folder, FolderTree, FileJson, FileSpreadsheet,
  GitCommit, GitMerge, GitPullRequest,
  Plug, Radio, Wifi, Cloud, CloudOff,
  Palette, Type, Image, PieChart
} from 'lucide-vue-next'

const props = defineProps<{
  name: string
  size?: number | string
  color?: string
  strokeWidth?: number | string
}>()

const iconMap: Record<string, any> = {
  'shield': Shield, 'shield-check': ShieldCheck, 'shield-alert': ShieldAlert,
  'zap': Zap, 'package': Package, 'search': Search,
  'file-text': FileText, 'file': FileText,
  'settings': Settings, 'rocket': Rocket,
  'alert-triangle': AlertTriangle, 'warning': AlertTriangle,
  'alert-circle': AlertCircle, 'alert': AlertCircle,
  'check-circle': CheckCircle2, 'circle-check': CircleCheck,
  'x-circle': XCircle, 'circle-x': CircleX,
  'circle-alert': CircleAlert, 'circle': Circle,
  'bar-chart': BarChart3, 'chart': BarChart3,
  'link': Link2, 'lightbulb': Lightbulb, 'tip': Lightbulb,
  'folder-open': FolderOpen, 'folder': Folder, 'folder-tree': FolderTree,
  'user': User, 'users': Users,
  'clipboard-list': ClipboardList, 'clipboard-check': ClipboardCheck,
  'target': Target, 'refresh': RefreshCw,
  'trending-up': TrendingUp, 'trending-down': TrendingDown,
  'wrench': Wrench, 'tool': Wrench,
  'pen': PenLine, 'edit': PenLine,
  'tag': Tag, 'building': Building2,
  'test-tube': TestTube2, 'test': TestTube2,
  'database': Database, 'server': Server,
  'lock': Lock, 'globe': Globe,
  'code': Code, 'code-2': Code2,
  'git-branch': GitBranch, 'git-commit': GitCommit,
  'git-merge': GitMerge, 'git-pull-request': GitPullRequest,
  'layers': Layers, 'arrow-right': ArrowRight,
  'chevron-right': ChevronRight, 'chevron-down': ChevronDown,
  'external-link': ExternalLink, 'info': Info,
  'book-open': BookOpen, 'book': BookOpen,
  'terminal': Terminal, 'cpu': Cpu,
  'network': Network, 'hard-drive': HardDrive,
  'key': Key, 'eye': Eye, 'eye-off': EyeOff,
  'activity': Activity, 'bug': Bug, 'clock': Clock,
  'file-code': FileCode, 'file-json': FileJson,
  'file-spreadsheet': FileSpreadsheet,
  'filter': Filter, 'box': Box, 'layout': Layout,
  'blocks': Blocks, 'play': Play, 'puzzle': Puzzle,
  'map': Map, 'gauge': Gauge, 'workflow': Workflow,
  'binary': Binary, 'container': Container,
  'monitor-check': MonitorCheck, 'scan': ScanLine,
  'sparkles': Sparkles, 'circle-dot': CircleDot,
  'cog': Cog, 'heart': Heart, 'star': Star,
  'hash': Hash, 'list': List, 'list-checks': ListChecks,
  'stop': AlertOctagon, 'ban': Ban,
  'thumbs-up': ThumbsUp, 'thumbs-down': ThumbsDown,
  'download': Download, 'upload': Upload,
  'share': Share2, 'bookmark': Bookmark,
  'message': MessageSquare, 'bell': Bell, 'mail': Mail,
  'plug': Plug, 'radio': Radio, 'wifi': Wifi,
  'cloud': Cloud, 'cloud-off': CloudOff,
  'palette': Palette, 'type': Type, 'image': Image,
  'pie-chart': PieChart
}

const icon = computed(() => iconMap[props.name?.toLowerCase()] || null)
const iconSize = computed(() => Number(props.size) || 18)
const iconStroke = computed(() => Number(props.strokeWidth) || 1.75)
</script>

<template>
  <component
    :is="icon"
    :size="iconSize"
    :color="color"
    :stroke-width="iconStroke"
    class="wiki-icon"
    v-if="icon"
  />
  <span v-else class="wiki-icon-fallback">{{ name }}</span>
</template>

<style scoped>
.wiki-icon {
  display: inline-block;
  vertical-align: -0.15em;
  flex-shrink: 0;
}
.wiki-icon-fallback {
  font-size: 0.75em;
  opacity: 0.5;
}
</style>
