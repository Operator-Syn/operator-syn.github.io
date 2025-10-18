import { useState, Fragment } from "react";
import "./ImageWithPlaceholder.css";

// Circle placeholder only for profile image
export function ProfileImage({ src, alt }: { src: string; alt: string }) {
    const [loaded, setLoaded] = useState(false);

    return (
        <Fragment>
        <div className="ratio ratio-1x1" style={{ maxWidth: "155px" }}>
            {!loaded && (
                <span
                    className="placeholder rounded-circle col-12 placeholder-wave profile-placeholder"
                ></span>
            )}
            <img
                src={src}
                alt={alt}
                className={`img-fluid rounded-circle custom-border profile-image ${loaded ? "d-block" : "d-none"}`}
                onLoad={() => setLoaded(true)}
            />
        </div>
        </Fragment>
    );
}

// Placeholder matches original image shape (no circle)
export function LazyImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
    const [loaded, setLoaded] = useState(false);

    return (
        <Fragment>
            {!loaded && <span className="placeholder placeholder-wave lazy-placeholder"></span>}
            <img
                src={src}
                alt={alt}
                className={`${className || ""} lazy-image ${loaded ? "d-inline-block m-0" : "d-none"}`}
                onLoad={() => setLoaded(true)}
            />
        </Fragment>
    );
}
