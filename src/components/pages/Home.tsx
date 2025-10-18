import { Fragment, useEffect, useState } from "react";
import "./Home.css";
import Clock from "../clock/Clock";
import { ProfileImage, LazyImage } from "./ImageWithPlaceholder";

export default function Home() {
    const [content, setContent] = useState<any>(null);

    useEffect(() => {
        import("../../data/content").then((module) => {
            setContent(module);
        });
    }, []);

    if (!content) return null;

    const { homeContent, devLoadoutsContent, profileInfo, socialLinksContent } = content;
    const { headerPhrase, elevatorPitch, profileImage } = homeContent;

    return (
        <Fragment>
            <div className="homePageContent">
                
                <div className="leftSide">
                    
                    <div className="header">
                        <h1 className="headerPhrase m-0">{headerPhrase}</h1>
                    </div>

                    <div className="contentWrapper">

                        <div className="elevatorPitch rounded-border">
                            {elevatorPitch.map((item: any, index: number) => (
                                <div key={index}>
                                    <h2 className="m-0">{item.title}</h2>
                                    <hr />
                                    <p className="text-justify">{item.content}</p>
                                </div>
                            ))}
                        </div>

                        <div className="devLoadouts rounded-border">
                            <h2 className="m-0">{devLoadoutsContent.header}</h2>
                            <hr />
                            {devLoadoutsContent.sections.map((section: any) => (
                                <div key={section.category}>
                                    <p>{section.category}</p>
                                    <div>
                                        {section.badges.map((url: string) => (
                                            <LazyImage key={url} src={url} alt="Badge" />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                    </div>
                </div>

                <div className="rightSide">

                    <div className="imageWrapper d-flex justify-content-center align-items-center">
                        <ProfileImage src={profileImage} alt="Profile Picture" />
                    </div>

                    <div className="spacer">
                        
                        <div className="profileDetails d-flex flex-column align-items-center justify-content-center rounded-border">
                            {profileInfo.map((info: any) => (
                                <p key={info.label} className="text-center m-0">
                                    {info.label}: {info.value}
                                </p>
                            ))}
                        </div>

                        <div className="socialLinks d-flex flex-wrap gap-2 justify-content-center align-items-center rounded-border">
                            {socialLinksContent.badges.map((badge: any) => (
                                <a href={badge.href} target="_blank" rel="noopener noreferrer" key={badge.alt}>
                                    <LazyImage src={badge.img} alt={badge.alt} className="socialIcon" />
                                </a>
                            ))}
                        </div>

                        <div className="etC rounded-border d-flex flex-column">
                            <Clock />
                        </div>
                    </div>

                </div>
            </div>
        </Fragment>
    );
}
