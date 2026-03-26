// Payment Gateway Platform Wiki — VitePress Config
// Generated from catalogue.json

import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { groupIconMdPlugin, groupIconVitePlugin } from 'vitepress-plugin-group-icons'

export default withMermaid(
  defineConfig({
    title: 'Payment Gateway',
    description: 'Internal payment processing and subscription billing platform for Enviro',
    appearance: 'dark',
    ignoreDeadLinks: true,
    lastUpdated: true,
    cleanUrls: true,

    head: [
      ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
      [
        'link',
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap',
        },
      ],
    ],

    markdown: {
      lineNumbers: true,
      image: { lazyLoading: true },
      container: {
        tipLabel: 'TIP',
        warningLabel: 'WARNING',
        dangerLabel: 'DANGER',
        infoLabel: 'INFO',
        detailsLabel: 'Details',
      },
      config(md) {
        md.use(groupIconMdPlugin);
      },
    },

    vite: {
      optimizeDeps: { include: ['mermaid'] },
      plugins: [groupIconVitePlugin()],
      server: { allowedHosts: true },
    },

    themeConfig: {
      logo: '/favicon.png',
      siteTitle: 'Payment Gateway',
      outline: { level: [2, 3] },

      nav: [
        { text: 'Home', link: '/' },
      ],

      sidebar: [
        {
          text: 'ONBOARDING',
          collapsed: false,
          items: [
            { text: 'Contributor Guide', link: '/onboarding/contributor' },
            { text: 'Staff Engineer Guide', link: '/onboarding/staff-engineer' },
            { text: 'Executive Guide', link: '/onboarding/executive' },
            { text: 'Product Manager Guide', link: '/onboarding/product-manager' },
          ],
        },
        {
          text: 'GETTING STARTED',
          collapsed: false,
          items: [
            { text: 'Platform Overview', link: '/01-getting-started/platform-overview' },
            { text: 'Integration Quickstart', link: '/01-getting-started/integration-quickstart' },
            { text: 'Environment Setup', link: '/01-getting-started/environment-setup' },
          ],
        },
        {
          text: 'ARCHITECTURE',
          collapsed: false,
          items: [
            {
              text: 'Payment Service',
              collapsed: true,
              items: [
                { text: 'Architecture', link: '/02-architecture/payment-service/index' },
                { text: 'Database Schema', link: '/02-architecture/payment-service/schema' },
                { text: 'API Reference', link: '/02-architecture/payment-service/api' },
              ],
            },
            {
              text: 'Billing Service',
              collapsed: true,
              items: [
                { text: 'Architecture', link: '/02-architecture/billing-service/index' },
                { text: 'Database Schema', link: '/02-architecture/billing-service/schema' },
                { text: 'API Reference', link: '/02-architecture/billing-service/api' },
              ],
            },
            { text: 'Inter-Service Communication', link: '/02-architecture/inter-service-communication' },
            { text: 'Event System and Webhooks', link: '/02-architecture/event-system' },
          ],
        },
        {
          text: 'DEEP DIVE',
          collapsed: false,
          items: [
            { text: 'Provider Integrations', link: '/03-deep-dive/provider-integrations' },
            {
              text: 'Security and Compliance',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/03-deep-dive/security-compliance/index' },
                { text: 'Multi-Tenant Isolation', link: '/03-deep-dive/security-compliance/tenant-isolation' },
                { text: 'Authentication Models', link: '/03-deep-dive/security-compliance/authentication' },
              ],
            },
            {
              text: 'Data Flows',
              collapsed: true,
              items: [
                { text: 'Overview', link: '/03-deep-dive/data-flows/index' },
                { text: 'Subscription Lifecycle', link: '/03-deep-dive/data-flows/subscription-lifecycle' },
              ],
            },
            { text: 'Correctness and Testing', link: '/03-deep-dive/correctness-invariants' },
            { text: 'Observability and Operations', link: '/03-deep-dive/observability' },
          ],
        },
        {
          text: 'REVIEWS',
          collapsed: true,
          items: [
            { text: 'Tech Stack Review', link: '/04-reviews/tech-stack-review' },
            { text: 'API Review', link: '/04-reviews/api-review' },
          ],
        },
      ],

      search: { provider: 'local' },
      lastUpdated: { text: 'Last updated', formatOptions: { dateStyle: 'medium' } },
      footer: { message: 'Payment Gateway Platform — Internal Technical Documentation' },
    },

    mermaid: {
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#0d1117',
        primaryColor: '#2d333b',
        primaryTextColor: '#e6edf3',
        primaryBorderColor: '#FF5A4F',
        secondaryColor: '#1c2333',
        secondaryTextColor: '#e6edf3',
        secondaryBorderColor: '#FF5A4F',
        tertiaryColor: '#161b22',
        tertiaryTextColor: '#e6edf3',
        tertiaryBorderColor: '#30363d',
        lineColor: '#8b949e',
        textColor: '#e6edf3',
        mainBkg: '#2d333b',
        nodeBkg: '#2d333b',
        nodeBorder: '#FF5A4F',
        nodeTextColor: '#e6edf3',
        clusterBkg: '#161b22',
        clusterBorder: '#30363d',
        titleColor: '#e6edf3',
        edgeLabelBackground: '#1c2333',
        actorBkg: '#2d333b',
        actorTextColor: '#e6edf3',
        actorBorder: '#FF5A4F',
        actorLineColor: '#8b949e',
        signalColor: '#e6edf3',
        signalTextColor: '#e6edf3',
        labelBoxBkgColor: '#2d333b',
        labelBoxBorderColor: '#FF5A4F',
        labelTextColor: '#e6edf3',
        loopTextColor: '#e6edf3',
        activationBorderColor: '#FF5A4F',
        activationBkgColor: '#1c2333',
        sequenceNumberColor: '#e6edf3',
        noteBkgColor: '#2d333b',
        noteTextColor: '#e6edf3',
        noteBorderColor: '#FF5A4F',
        classText: '#e6edf3',
        labelColor: '#e6edf3',
        altBackground: '#161b22',
      },
    },
  }),
)
