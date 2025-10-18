import type { FC } from "react";

export interface NavLinkItem {
    name: string;
    path: string;
    component?: FC | null; // optional component
}

export interface NavBarProps {
    brandName: string;
    links: NavLinkItem[];
}
