function scientificNotation(value) {
    if (
        value === 0 ||
        !Number.isFinite(value) ||
        (Math.abs(value) >= 1 && Math.abs(value) <= 1000)
    ) {
        return rawFormatter(value);
    }
    value = parseFloat(value);
    value = value.toExponential(2);
    value = value.replace("+", "");
    return value;
}

// The number styles FrozenCookies.numberDisplay chooses from in fcBeautify. Named apart from the
// game's own numberFormatters (main.js:216), which the game's Beautify picks from.
var fcNumberFormatters = [
    rawFormatter,
    formatEveryThirdPower(formatLong), // 1: long: millions, billions etc.
    formatEveryThirdPower(formatShort), // 2: short: M, B, T etc.
    formatEveryThirdPower([
        // 3: SI prefixes: M, G, T etc.
        "",
        " M",
        " G",
        " T",
        " P",
        " E",
        " Z",
        " Y",
        " R",
        " Q",
    ]),
    scientificNotation, // 4: scientific: 6.3e12 etc.
];

// The game's Beautify, kept when the legacy code is first evaluated, before setOverrides
// replaces the global with fcBeautify.
var fcGameBeautify = typeof fcGameBeautify == "function" ? fcGameBeautify : Beautify;

// Replaces the game's Beautify. At the default style (1, the game's own) the game formats, so its
// Short numbers option keeps working. Another style formats alike otherwise: whole numbers,
// with `floats` decimals below 1000 (main.js:222-237).
function fcBeautify(value, floats) {
    var formatter = fcNumberFormatters[FrozenCookies.numberDisplay];
    value = Number(value);
    if (FrozenCookies.numberDisplay == 1 || !formatter) return fcGameBeautify(value, floats);
    var negative = value < 0;
    var decimal = "";
    var fixed = value.toFixed(floats);
    if (floats > 0 && Math.abs(value) < 1000 && Math.floor(fixed) != fixed) {
        decimal = "." + fixed.toString().split(".")[1];
    }
    value = Math.floor(Math.abs(value));
    if (floats > 0 && fixed == value + 1) value++;
    // There are no SI prefixes larger than 1e30, so we'll use scientific notation
    // The game will show Infinity otherwise, which is not useful
    if (FrozenCookies.numberDisplay === 3 && value >= 1e33) formatter = fcNumberFormatters[4];
    var output = formatter(value)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (output == "0") negative = false;
    return negative ? "-" + output : output + decimal;
}

// Runs numbers in upgrades and achievements through our beautify function
function beautifyUpgradesAndAchievements() {
    function beautifyFn(str) {
        return Beautify(parseInt(str.replace(/,/, ""), 10));
    }

    var numre = /\d\d?\d?(?:,\d\d\d)*/;
    Object.values(Game.AchievementsById).forEach(function (ach) {
        ach.desc = ach.desc.replace(numre, beautifyFn);
    });

    // These might not have any numbers in them, but just in case...
    Object.values(Game.UpgradesById).forEach(function (upg) {
        upg.desc = upg.desc.replace(numre, beautifyFn);
    });
}

function timeDisplay(seconds) {
    if (seconds === "---" || seconds === 0) {
        return "Done!";
    } else if (seconds == Number.POSITIVE_INFINITY) {
        return "Never!";
    }
    seconds = Math.floor(seconds);
    var years, days, hours, minutes;
    years = Math.floor(seconds / (365.25 * 24 * 60 * 60));
    years = years > 0 ? Beautify(years) + "y " : "";
    seconds %= 365.25 * 24 * 60 * 60;
    days = Math.floor(seconds / (24 * 60 * 60));
    days = days > 0 ? days + "d " : "";
    seconds %= 24 * 60 * 60;
    hours = Math.floor(seconds / (60 * 60));
    hours = hours > 0 ? hours + "h " : "";
    seconds %= 60 * 60;
    minutes = Math.floor(seconds / 60);
    minutes = minutes > 0 ? minutes + "m " : "";
    seconds %= 60;
    seconds = seconds > 0 ? seconds + "s" : "";
    return (years + days + hours + minutes + seconds).trim();
}

// The size of the infobox's text block: its widest label, and all its lines. Measured when the
// infobox is computed, not on every draw; only the text styles (odd fancyui) show text.
function measureInfoboxText(t_d) {
    var c = $("#backgroundLeftCanvas");
    if (FrozenCookies.fancyui % 2 != 1 || typeof c.measureText != "function") {
        return { width: 0, height: 0 };
    }
    var maxText = _.max(
        t_d.map(function (o) {
            return o.name ? o.name + (o.display ? ": " + o.display : "") : "";
        }),
        function (str) {
            return str.length;
        }
    );
    var maxMeasure = c.measureText({
        fontSize: "12px",
        fontFamily: "Arial",
        maxWidth: c.width,
        text: maxText,
    });
    return { width: maxMeasure.width, height: maxMeasure.height * t_d.length };
}

// functionality for the infobox
function drawCircles(t_d, x, y, textSize) {
    var maxRadius,
        heightOffset,
        i_c,
        i_tc,
        t_b,
        maxWidth,
        maxHeight,
        s_t,
        c = $("#backgroundLeftCanvas");
    if (typeof c.drawArc != "function") {
        return;
    }
    maxRadius =
        10 +
        10 *
            t_d.reduce(function (sum, item) {
                return item.overlay ? sum : sum + 1;
            }, 0);
    heightOffset = maxRadius + 5 - (15 * (t_d.length - 1)) / 2;
    i_c = 0;
    i_tc = 0;
    t_b = [
        "rgba(170, 170, 170, 1)",
        "rgba(187, 187, 187, 1)",
        "rgba(204, 204, 204, 1)",
        "rgba(221, 221, 221, 1)",
        "rgba(238, 238, 238, 1)",
        "rgba(255, 255, 255, 1)",
    ];
    maxWidth = textSize.width;
    maxHeight = textSize.height;
    if (FrozenCookies.fancyui % 2 == 1)
        c.drawRect({
            fillStyle: "rgba(153, 153, 153, 0.6)",
            x: x + maxRadius * 2 + maxWidth / 2 + 35,
            y: y + maxRadius + 5,
            width: maxWidth + 20,
            height: maxHeight + 20,
        });

    t_d.forEach(function (o_draw) {
        if (o_draw.overlay) {
            i_c--;
        } else {
            if (FrozenCookies.fancyui > 1) {
                c.drawArc({
                    strokeStyle: t_b[i_c % t_b.length],
                    strokeWidth: 10,
                    x: x + (maxRadius + 5),
                    y: y + maxRadius + 5,
                    radius: maxRadius - i_c * 10,
                });
                c.drawArc({
                    strokeStyle: t_b[(i_c + 2) % t_b.length],
                    strokeWidth: 1,
                    x: x + (maxRadius + 5),
                    y: y + maxRadius + 5,
                    radius: maxRadius - 5 - i_c * 10,
                });
            }
        }
        if (FrozenCookies.fancyui > 1) {
            c.drawArc({
                strokeStyle: o_draw.c1,
                x: x + (maxRadius + 5),
                y: y + maxRadius + 5,
                radius: maxRadius - i_c * 10,
                strokeWidth: 7,
                start: 0,
                end: 360 * o_draw.f_percent,
            });
        }
        if (FrozenCookies.fancyui % 2 == 1 && o_draw.name) {
            s_t = o_draw.name + (o_draw.display ? ": " + o_draw.display : "");
            c.drawText({
                fontSize: "12px",
                fontFamily: "Arial",
                fillStyle: o_draw.c1,
                x: x + maxRadius * 2 + maxWidth / 2 + 35,
                y: y + heightOffset + 15 * i_tc,
                text: s_t,
            });
            i_tc++;
        }
        i_c++;
    });
}

function hasBuildingSpecialBuff() {
    for (var i in Game.buffs) {
        if (
            Game.buffs[i].type &&
            (Game.buffs[i].type.name == "building buff" ||
                Game.buffs[i].type.name == "building debuff")
        ) {
            return Game.buffs[i].time;
        }
    }
    return 0;
}

function buildingSpecialBuffValue() {
    for (var i in Game.buffs) {
        if (
            Game.buffs[i].type &&
            (Game.buffs[i].type.name == "building buff" ||
                Game.buffs[i].type.name == "building debuff")
        ) {
            return Game.buffs[i].multCpS;
        }
    }
    return 0;
}

function buffDuration(buffName) {
    var buff = Game.hasBuff(buffName);
    return buff ? buff.time : 0;
}

// Works out what the infobox shows. Runs on the loop a few times a second while the infobox is
// on; drawInfobox draws it.
function updateTimers() {
    if (!FrozenCookies.fancyui) return;
    var chainPurchase,
        bankPercent,
        purchasePercent,
        bankMax,
        actualCps,
        t_draw,
        maxColor,
        height,
        // The next golden cookie is expected about 86% of the way from the shortest to the longest wait.
        gc_delay =
            (Game.shimmerTypes.golden.minTime +
                0.86 * (maxCookieTime() - Game.shimmerTypes.golden.minTime) -
                Game.shimmerTypes.golden.time) /
            maxCookieTime(),
        gc_max_delay =
            (maxCookieTime() - Game.shimmerTypes.golden.time) / maxCookieTime(),
        gc_min_delay =
            (Game.shimmerTypes.golden.minTime - Game.shimmerTypes.golden.time) /
            maxCookieTime(),
        clot_delay = buffDuration("Clot") / maxCookieTime(),
        elder_frenzy_delay = buffDuration("Elder frenzy") / maxCookieTime(),
        frenzy_delay = buffDuration("Frenzy") / maxCookieTime(),
        dragon_harvest_delay = buffDuration("Dragon Harvest") / maxCookieTime(),
        click_frenzy_delay = buffDuration("Click frenzy") / maxCookieTime(),
        dragonflight_delay = buffDuration("Dragonflight") / maxCookieTime(),
        cursed_finger_delay = buffDuration("Cursed finger") / maxCookieTime(),
        building_special_delay = hasBuildingSpecialBuff() / maxCookieTime(),
        cookie_storm_delay = buffDuration("Cookie storm") / maxCookieTime(),
        // useless decimal_HC_complete = (Game.HowMuchPrestige(Game.cookiesEarned + Game.cookiesReset)%1),
        bankTotal = delayAmount(),
        purchaseTotal = nextPurchase().cost,
        bankCompletion = bankTotal
            ? Math.min(Game.cookies, bankTotal) / bankTotal
            : 0,
        purchaseCompletion = Game.cookies / (bankTotal + purchaseTotal),
        bankPurchaseCompletion = bankTotal / (bankTotal + purchaseTotal),
        chainTotal = 0,
        chainFinished,
        chainCompletion = 0;
    c = $("#backgroundLeftCanvas");
    bankPercent =
        Math.min(Game.cookies, bankTotal) / (bankTotal + purchaseTotal);
    purchasePercent = purchaseTotal / (purchaseTotal + bankTotal);
    bankMax = bankTotal / (purchaseTotal + bankTotal);
    // Clicks at the rate the clicker measures, 0 with Autoclick off.
    actualCps =
        Game.cookiesPs + Game.mouseCps() * MushieCookies.clicksPerSecond(FrozenCookies);

    t_draw = [];

    if (chainTotal) {
        t_draw.push({
            f_percent: chainCompletion,
            c1: "rgba(51, 51, 51, 1)",
            name: "Chain to: " + decodeHtml(chainPurchase.name),
            display: timeDisplay(
                divCps(
                    Math.max(
                        chainTotal + bankTotal - Game.cookies - chainFinished,
                        0
                    ),
                    actualCps
                )
            ),
        });
    }
    if (
        purchaseTotal > 0 &&
        nextPurchase().type == "building" &&
        Game.season == "fools"
    ) {
        t_draw.push({
            f_percent: purchaseCompletion,
            c1: "rgba(17, 17, 17, 1)",
            name:
                "Next: " +
                decodeHtml(Game.foolObjects[nextPurchase().purchase.name].name),
            display: timeDisplay(
                divCps(
                    Math.max(purchaseTotal + bankTotal - Game.cookies, 0),
                    actualCps
                )
            ),
        });
    } else {
        t_draw.push({
            f_percent: purchaseCompletion,
            c1: "rgba(17, 17, 17, 1)",
            name: "Next: " + decodeHtml(nextPurchase().purchase.name),
            display: timeDisplay(
                divCps(
                    Math.max(purchaseTotal + bankTotal - Game.cookies, 0),
                    actualCps
                )
            ),
        });
    }
    if (bankMax > 0) {
        if (bankPercent > 0 && Game.cookies < bankTotal) {
            t_draw.push({
                f_percent: bankPercent,
                c1: "rgba(252, 212, 0, 1)",
                name: "Bank Completion",
                display: timeDisplay(
                    divCps(Math.max(bankTotal - Game.cookies, 0), actualCps)
                ),
                overlay: true,
            });
        }
    }
    if (gc_delay > 0) {
        t_draw.push({
            f_percent: gc_max_delay,
            c1: "rgba(255, 155, 0, 1)",
            name: "GC Maximum (99%)",
            display: timeDisplay((gc_max_delay * maxCookieTime()) / Game.fps),
        });
        t_draw.push({
            f_percent: gc_delay,
            c1: "rgba(255, 222, 95, 1)",
            name: "GC Estimate (50%)",
            display: timeDisplay((gc_delay * maxCookieTime()) / Game.fps),
            overlay: true,
        });
        t_draw.push({
            f_percent: gc_min_delay,
            c1: "rgba(255, 235, 0, 1)",
            name: "GC Minimum (1%)",
            display: timeDisplay((gc_min_delay * maxCookieTime()) / Game.fps),
            overlay: true,
        });
    }
    if (clot_delay > 0) {
        t_draw.push({
            f_percent: clot_delay,
            c1: "rgba(255, 54, 5, 1)",
            name: "Clot (x" + Game.buffs["Clot"].multCpS + ") Time",
            display: timeDisplay(buffDuration("Clot") / Game.fps),
        });
    }
    if (elder_frenzy_delay > 0) {
        t_draw.push({
            f_percent: elder_frenzy_delay,
            c1: "rgba(79, 0, 7, 1)",
            name:
                "Elder Frenzy (x" +
                Game.buffs["Elder frenzy"].multCpS +
                ") Time",
            display: timeDisplay(buffDuration("Elder frenzy") / Game.fps),
        });
    }
    if (frenzy_delay > 0) {
        t_draw.push({
            f_percent: frenzy_delay,
            c1: "rgba(255, 222, 95, 1)",
            name: "Frenzy (x" + Game.buffs["Frenzy"].multCpS + ") Time",
            display: timeDisplay(buffDuration("Frenzy") / Game.fps),
        });
    }
    if (dragon_harvest_delay > 0) {
        t_draw.push({
            f_percent: dragon_harvest_delay,
            c1: "rgba(206, 180, 49, 1)",
            name:
                "Dragon Harvest (x" +
                Game.buffs["Dragon Harvest"].multCpS +
                ") Time",
            display: timeDisplay(buffDuration("Dragon Harvest") / Game.fps),
        });
    }
    if (click_frenzy_delay > 0) {
        t_draw.push({
            f_percent: click_frenzy_delay,
            c1: "rgba(0, 196, 255, 1)",
            name:
                "Click Frenzy (x" +
                Game.buffs["Click frenzy"].multClick +
                ") Time",
            display: timeDisplay(buffDuration("Click frenzy") / Game.fps),
        });
    }
    if (dragonflight_delay > 0) {
        t_draw.push({
            f_percent: dragonflight_delay,
            c1: "rgba(183, 206, 49, 1)",
            name:
                "Dragonflight (x" +
                Game.buffs["Dragonflight"].multClick +
                ") Time",
            display: timeDisplay(buffDuration("Dragonflight") / Game.fps),
        });
    }
    if (cursed_finger_delay > 0) {
        t_draw.push({
            f_percent: cursed_finger_delay,
            c1: "rgba(23, 79, 1, 1)",
            name: "Cursed Finger Time",
            display: timeDisplay(buffDuration("Cursed finger") / Game.fps),
        });
    }
    if (building_special_delay > 0) {
        t_draw.push({
            f_percent: building_special_delay,
            c1: "rgba(218, 165, 32, 1)",
            name: "Building Special (x" + buildingSpecialBuffValue() + ") Time",
            display: timeDisplay(hasBuildingSpecialBuff() / Game.fps),
        });
    }
    if (cookie_storm_delay > 0) {
        t_draw.push({
            f_percent: cookie_storm_delay,
            c1: "rgba(0, 196, 255, 1)",
            name: "Cookie Storm Time",
            display: timeDisplay(buffDuration("Cookie storm") / Game.fps),
        });
    }
    FrozenCookies.infoboxFrame = {
        t_draw: t_draw,
        textSize: measureInfoboxText(t_draw),
        frenzy: cpsBonus() * clickBuffBonus(),
    };
}

// Draws the last computed infobox. Runs from the game's draw hook, which comes after the game
// has cleared the left canvas; drawing any earlier is erased before the frame is shown.
function drawInfobox() {
    if (!FrozenCookies.fancyui) {
        // Off (the default): nothing to draw, and nothing stale to show when it is switched back on.
        FrozenCookies.infoboxFrame = null;
        return;
    }
    var frame = FrozenCookies.infoboxFrame;
    if (!frame) return;
    var c = $("#backgroundLeftCanvas");
    var height = c.height() - 140;
    drawCircles(frame.t_draw, 20, height, frame.textSize);

    // Calculate currentFrenzy before drawing it
    var currentFrenzy = frame.frenzy;
    // Draw the current frenzy at the bottom of the canvas. A plain draw: the game clears the
    // canvas every frame, and a jCanvas layer only added a text measurement to each draw.
    if (typeof c.drawText === "function") {
        c.drawText({
            fontSize: "14px",
            fontFamily: "Arial",
            fillStyle: "#fff",
            x: c.width() / 2,
            y: c.height() - 18,
            text: "Frenzy: " + fcBeautify(currentFrenzy),
            align: "center",
            baseline: "bottom",
        });
    }
}