import { Bot, ExternalLink, ShieldCheck } from "lucide-react";
import StaticAppPage, { type StaticAppPageConfig } from "../staticAppPage/StaticAppPage";

const agentPageConfig: StaticAppPageConfig = {
  title: "Feilhann Agent",
  description: "Feilhann Agent homepage for Syn-Forge and Google project verification.",
  url: "https://syn-forge.com/agent",
  kicker: "Syn-Forge authenticated assistant",
  heading: "Feilhann Agent",
  heroParagraphs: [
    "This page identifies Feilhann Agent available from syn-forge.com. It answers questions about the public portfolio using a bounded, read-only evidence source.",
    "Google Sign-In is used to create a private assistant session for the visitor. Google account data is used for identity, access control, and security—not advertising or unrelated services.",
  ],
  summaryItems: [
    {
      label: "Application",
      value: "Authenticated assistant for the Syn-Forge portfolio",
    },
    {
      label: "Operator",
      value: "Syn-Forge and Operator-Syn, operated by John-Ronan S. Beira",
    },
    {
      label: "Public entry",
      value: "syn-forge.com with the assistant service at assistant.syn-forge.com",
    },
    {
      label: "Purpose",
      value: "Evidence-grounded portfolio questions and private thread history",
    },
  ],
  policyReturnLabel: "Feilhann Agent",
  policyReturnTo: "/agent",
  sections: [
    {
      title: "Google Project Verification",
      icon: ShieldCheck,
      paragraphs: [
        "Feilhann Agent uses Google Sign-In through public-auth.syn-forge.com before opening a private conversation. The sign-in flow confirms the visitor's Google identity and returns them to the portfolio.",
        "The application uses the basic account information authorized on the Google consent screen to identify the visitor, maintain a session, and protect their private assistant threads.",
      ],
      listItems: [
        "Google data is limited to the authentication and security needs of the assistant.",
        "Google access and refresh tokens are not stored by the application.",
        "Google user data is not sold, used for advertising, or used to train general-purpose models.",
      ],
    },
    {
      title: "Assistant Scope",
      icon: Bot,
      paragraphs: [
        "The assistant answers portfolio questions from Syn-Forge's public, read-only Portfolio MCP. It does not change accounts, repositories, portfolio records, or external services.",
        "Authenticated visitors may keep a private thread history for the assistant experience. Sessions and stored records follow the retention, access, and deletion terms described in the linked policy pages.",
      ],
      listItems: [
        "Responses are grounded in public portfolio evidence and may include canonical source links.",
        "The assistant does not perform unrelated general-purpose work or external actions.",
        "Turnstile and server-side session checks help protect the authenticated boundary.",
      ],
    },
    {
      title: "Related Policies",
      icon: ExternalLink,
      paragraphs: [
        "Syn-Forge policy pages describe Google OAuth data handling, service providers, retention, user requests, and the terms that apply to this assistant.",
      ],
      includePolicyLinks: true,
    },
  ],
};

export default function Agent() {
  return <StaticAppPage config={agentPageConfig} />;
}
