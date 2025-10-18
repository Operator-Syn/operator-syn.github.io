import { Fragment, type ReactNode } from 'react';
import "./CookingArea.css";

interface CookingAreaProps {
    children?: ReactNode;
}

export default function CookingArea({ children }: CookingAreaProps) {
    return (
        <Fragment>
            <div id="wrapper">
                <div id="cookingArea" className="d-flex">
                    {children}
                </div>
            </div>
        </Fragment>
    )
}