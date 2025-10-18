import { useState, useEffect, useMemo } from "react";

// Custom hook to return current time updated every second
function useClock() {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    return time;
}

export default function Clock() {
    const time = useClock();

    // Compute greeting only when time changes
    const greeting = useMemo(() => {
        const hour = time.getHours();
        if (hour >= 5 && hour < 12) return "Good Morning!";
        if (hour >= 12 && hour < 14) return "Good Noon";
        if (hour >= 14 && hour < 18) return "Good Afternoon!";
        return "Good Evening!";
    }, [time]);

    // Format time only when time changes
    const formattedTime = useMemo(() => {
        let hour = time.getHours();
        const minute = String(time.getMinutes()).padStart(2, "0");
        const second = String(time.getSeconds()).padStart(2, "0");
        const ampm = hour >= 12 ? "PM" : "AM";
        hour = hour % 12 || 12;
        return `${String(hour).padStart(2, "0")}:${minute}:${second} ${ampm}`;
    }, [time]);

    return (
        <section>
            <p className="m-0">{greeting} → {formattedTime}</p>
            <p className="m-0">❏ Take a look around — I hope you find something that inspires you.</p>
        </section>
    );
}