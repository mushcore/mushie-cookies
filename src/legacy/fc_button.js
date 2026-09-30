// This file replaces the Info button with the Frozen Cookies button
// which adds a new menu for Frozen Cookies

$("#logButton").before(
    $("<div>")
        .attr("id", "fcButton")
        .addClass("button panelButton")
        .html("Mushie<br />Cookies")
        .click(function () {
            Game.ShowMenu("fc_menu");
        })
);

$("#logButton").hide();

$("<style>")
    .prop("type", "text/css")
    .text(
        "#fcEfficiencyTable {width: 100%;}" +
            "#fcButton {top: 0px; right: 0px; padding-top: 12px; font-size: 90%; background-position: -100px 0px;}" +
            ".worst {border-width:1px; border-style:solid; border-color:#330000;}" +
            ".bad {border-width:1px; border-style:solid; border-color:#660033;}" +
            ".average {border-width:1px; border-style:solid; border-color:#663399;}" +
            ".good {border-width:1px; border-style:solid; border-color:#3399FF;}" +
            ".best {border-width:1px; border-style:solid; border-color:#00FFFF;}"
    )
    .appendTo("head");

if (typeof Game.oldUpdateMenu != "function") {
    Game.oldUpdateMenu = Game.UpdateMenu;
}

// Add custom styles
(function () {
    var style = document.createElement("style");
    style.innerHTML = `
        .fc-multichoice-group-vertical {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 4px 0;
        }
        .fc-multichoice-btn,
        .option {
            background: #111;
            color: #fff;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 4px 10px;
            margin: 0;
            cursor: pointer;
            font-size: 1em;
            text-align: left;
            transition: background 0.2s, color 0.2s, box-shadow 0.2s;
            opacity: 0.7; /* Default: greyed out */
            filter: grayscale(30%);
        }
        .fc-multichoice-group-vertical .selected,
        .option.selected {
            background: #222;
            color: #fff;
            font-weight: bold;
            opacity: 1;
            filter: none;
            /* Add shiny effect */
            box-shadow: 0 0 8px 2px #fff, 0 0 2px 1px #fff inset; /* Keep shiny effect, but neutral color */
        }
        .fc-multichoice-group-2col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px;
            margin: 4px 0;
        }
        .fc-multichoice-group-3col {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 4px;
            margin: 4px 0;
        }
        .fc-multichoice-btn:hover,
        .option:hover {
            background: #222;
            color: #fff;
            opacity: 1;
            filter: none;
            box-shadow: 0 0 8px 2px #fff, 0 0 2px 1px #cfc inset;
        }
        .fc-section-heading {
            font-variant: small-caps;
            font-weight: bold;
            letter-spacing: 1px;
            font-size: 1.1em;
            display: block;
            margin-bottom: 2px;
        }
        .fc-hint-label {
            font-size: smaller;
            color: #aaa;
            margin-bottom: 2px;
        }
        .fc-choose-one-label {
            font-size: smaller;
            color: #aaa;
            margin-bottom: 2px;
            margin-top: 10px; /* Add space above to separate from hint */
        }
        .fc-warning {
            font-size: smaller;
            color: #a00;
            margin-bottom: 6px;
        }
    `;
    document.head.appendChild(style);
})();

function FCMenu() {
    Game.UpdateMenu = function () {
        if (Game.onMenu !== "fc_menu") {
            return Game.oldUpdateMenu();
        }
        if (!Game.callingMenu) {
            Game.callingMenu = true;
            setTimeout(() => {
                Game.callingMenu = false;
                Game.UpdateMenu();
            }, 1000);
        }
        var currentCookies,
            maxCookies,
            isTarget,
            isMax,
            targetTxt,
            maxTxt,
            currHC,
            resetHC,
            cps,
            baseChosen,
            frenzyChosen,
            clickStr,
            buildTable,
            bankLucky,
            bankLuckyFrenzy,
            bankChain,
            menu = $("#menu")
                .empty()
                .append(
                    $("<div>")
                        .addClass("section")
                        .text(
                            "Mushie Cookies v " +
                                FrozenCookies.branch +
                                "." +
                                FrozenCookies.version
                        )
                )
                // Add the log/info panel button
                .append(
                    $("<div>")
                        .addClass("listing")
                        .append(
                            $("<button>")
                                .attr("id", "fcOpenLogPanel")
                                .attr(
                                    "title",
                                    "Open the Cookie Clicker about/version info panel"
                                )
                                .text("Cookie Clicker Info")
                                .click(openGameLogPanel)
                        )
                )
                // Add a documentations page button
                .append(
                    $("<div>")
                        .addClass("listing")
                        .append(
                            $("<button>")
                                .attr("id", "fcOpenDocPage")
                                .attr(
                                    "title",
                                    "Open the Mushie Cookies readme"
                                )
                                .text("Mushie Cookies Readme")
                                .click(openDocumentationPage)
                        )
                );

        // --- BUYING SECTION ---
        function buildListing(label, name) {
            return $("<div>")
                .addClass("listing")
                .append($("<b>").text(label + ":"), " ", name);
        }
        var report = MushieCookies.buyer ? MushieCookies.buyer.report() : null;
        subsection = $("<div>")
            .addClass("subsection")
            .append($("<div>").addClass("title").text("Buying"));
        if (report && report.income) {
            var income = report.income;
            var next = report.next;
            subsection.append(
                buildListing("Next purchase", next ? next.name : "nothing worth buying")
            );
            if (next) {
                subsection.append(buildListing("Cost", Beautify(next.price)));
                subsection.append(
                    buildListing("Adds per second", Beautify(next.deltaIncome))
                );
                subsection.append(
                    buildListing("Pays back in", timeDisplay(next.payback))
                );
                subsection.append(
                    buildListing(
                        "Ready in",
                        timeDisplay(
                            divCps(
                                Math.max(0, next.price + report.reserve - Game.cookies),
                                income.total
                            )
                        )
                    )
                );
            }
            subsection.append(
                buildListing("Golden cookie reserve", Beautify(report.reserve))
            );
            subsection.append(
                buildListing(
                    "Income per second",
                    Beautify(income.total) +
                        " (" +
                        Beautify(income.passive) +
                        " buildings, " +
                        Beautify(income.click) +
                        " clicks, " +
                        Beautify(income.golden) +
                        " golden cookies)"
                )
            );
            subsection.append(buildListing("Purchases this session", report.purchases));
            var table = $("<table>")
                .prop("id", "fcEfficiencyTable")
                .append(
                    $("<tr>").append(
                        $("<th>").text("Candidate"),
                        $("<th>").text("Cost"),
                        $("<th>").text("Adds / s"),
                        $("<th>").text("Pays back")
                    )
                );
            report.top.forEach(function (c) {
                table.append(
                    $("<tr>").append(
                        $("<td>").append($("<b>").text(c.name)),
                        $("<td>").text(Beautify(c.price)),
                        $("<td>").text(Beautify(c.deltaIncome)),
                        $("<td>").text(isFinite(c.payback) ? timeDisplay(c.payback) : "never")
                    )
                );
            });
            subsection.append($("<div>").addClass("listing").append(table));
        } else {
            subsection.append(buildListing("Next purchase", "not ranked yet"));
        }
        menu.append(subsection);

        // --- OPTIONS SECTION ---
        if (FrozenCookies.preferenceValues) {
            subsection = $("<div>").addClass("subsection");
            subsection.append(
                $("<div>").addClass("title").text("Mushie Cookies Controls"),
                // Add warning below the title
                $("<div>")
                    .addClass("fc-warning")
                    .text(" ⚠️ All options take effect immediately.")
            );
            _.keys(FrozenCookies.preferenceValues).forEach(function (
                preference
            ) {
                var listing,
                    prefVal = FrozenCookies.preferenceValues[preference],
                    hint = prefVal.hint,
                    display = prefVal.display,
                    extras = prefVal.extras,
                    current = FrozenCookies[preference],
                    preferenceButtonId = preference + "Button";
                if (display && display.length > 0 && display.length > current) {
                    listing = $("<div>").addClass("listing");
                    // Show hint as a subsection head before the button(s)
                    if (hint) {
                        listing.append(
                            $("<label>")
                                .addClass("fc-hint-label")
                                .text(
                                    hint.replace(
                                        /\$\{(.+)\}/g,
                                        function (s, id) {
                                            return FrozenCookies[id];
                                        }
                                    )
                                )
                        );
                    }
                    if (display.length === 2) {
                        // Render on/off option buttons side by side
                        var buttonGroup = $("<div>").addClass(
                            "fc-multichoice-group-2col"
                        );
                        display.forEach(function (label, idx) {
                            buttonGroup.append(
                                $("<button>")
                                    .addClass("option fc-multichoice-btn")
                                    .toggleClass("selected", idx === current)
                                    .prop("id", preferenceButtonId + "_" + idx)
                                    .click(function () {
                                        setPreferenceDirect(preference, idx);
                                    })
                                    .text(label)
                            );
                        });
                        listing.append(buttonGroup);
                    } else {
                        // Add "choose one" label automatically
                        listing.append(
                            $("<div>")
                                .addClass("fc-choose-one-label")
                                .text("Choose one:")
                        );
                        // Determine column class based on number of options
                        let groupClass = "fc-multichoice-group-vertical";
                        if (display.length > 8) {
                            groupClass = "fc-multichoice-group-3col";
                        } else if (display.length > 4) {
                            groupClass = "fc-multichoice-group-2col";
                        }
                        // Render a group of buttons for direct selection, stacked or in columns
                        var buttonGroup = $("<div>").addClass(groupClass);
                        display.forEach(function (label, idx) {
                            buttonGroup.append(
                                $("<button>")
                                    .addClass("option fc-multichoice-btn")
                                    .toggleClass("selected", idx === current)
                                    .prop("id", preferenceButtonId + "_" + idx)
                                    .click(function () {
                                        setPreferenceDirect(preference, idx);
                                    })
                                    .text(label)
                            );
                        });
                        listing.append(buttonGroup);
                    }
                    if (extras) {
                        // If extras is a function, call it with FrozenCookies, else treat as string
                        var extrasHtml =
                            typeof extras === "function"
                                ? extras(FrozenCookies)
                                : extras.replace(
                                      /\$\{(.+)\}/g,
                                      function (s, id) {
                                          return fcBeautify(FrozenCookies[id]);
                                      }
                                  );
                        listing.append($(extrasHtml));
                    }
                    subsection.append(listing);
                }
                // if no options, still display the hint as a subsection head
                if (!display) {
                    listing = $("<div>").addClass("fc-section-heading");
                    if (hint) {
                        listing.append(
                            $("<br>"),
                            $("<label>").text(
                                hint.replace(/\$\{(.+)\}/g, function (s, id) {
                                    return FrozenCookies[id];
                                })
                            )
                        );
                    }
                    subsection.append(listing);
                }
            });
            menu.append(subsection);
        }

        // --- ASCENSION SECTION ---
        subsection = $("<div>").addClass("subsection");
        subsection.append($("<div>").addClass("title").text("Ascension"));
        var ascension = MushieCookies.ascension ? MushieCookies.ascension.report() : null;
        subsection.append(buildListing("Prestige now", Beautify(Game.prestige)));
        subsection.append(buildListing("Heavenly chips", Beautify(Game.heavenlyChips)));
        if (ascension) {
            subsection.append(buildListing("Prestige if ascending now", Beautify(Math.floor(ascension.projected))));
            subsection.append(buildListing("Chips gained by ascending", Beautify(ascension.gain)));
            if (ascension.firstTarget) {
                subsection.append(buildListing("First ascension at", Beautify(ascension.firstTarget) + " prestige"));
            }
            if (ascension.verdict) {
                subsection.append(buildListing("Verdict", ascension.verdict.reason));
            }
            subsection.append(buildListing("This run", timeDisplay(ascension.runSeconds)));
            if (ascension.last) {
                subsection.append(
                    buildListing(
                        "Last ascension bought",
                        ascension.last.bought.join(", ") || "nothing"
                    )
                );
                if (ascension.last.saving) {
                    subsection.append(buildListing("Saving for", ascension.last.saving));
                }
                if (ascension.last.slots.length) {
                    subsection.append(buildListing("Permanent slots", ascension.last.slots.join(", ")));
                }
            }
        }
        menu.append(subsection);

        // --- HARVESTING (BANK) INFO SECTION ---
        if (FrozenCookies.setHarvestBankPlant) {
            subsection = $("<div>").addClass("subsection");
            subsection.append(
                $("<div>").addClass("title").text("Harvesting Information")
            );
            subsection.append(buildListing("Base CPS", Beautify(baseCps())));
            subsection.append(
                buildListing("Plant to harvest", FrozenCookies.harvestPlant)
            );
            subsection.append(
                buildListing(
                    "Minutes of CpS",
                    FrozenCookies.harvestMinutes + " min"
                )
            );
            subsection.append(
                buildListing(
                    "Max percent of Bank",
                    FrozenCookies.harvestMaxPercent * 100 + " %"
                )
            );
            subsection.append(
                buildListing(
                    "Single " +
                        FrozenCookies.harvestPlant +
                        (FrozenCookies.setHarvestBankPlant < 6
                            ? " harvesting"
                            : " exploding") +
                        "",
                    Beautify(
                        (baseCps() *
                            60 *
                            FrozenCookies.harvestMinutes *
                            FrozenCookies.harvestFrenzy *
                            FrozenCookies.harvestBuilding) /
                            Math.pow(10, FrozenCookies.maxSpecials)
                    )
                )
            );
            subsection.append(
                buildListing(
                    "Full garden " +
                        (FrozenCookies.setHarvestBankPlant < 6
                            ? " harvesting"
                            : " exploding") +
                        " (36 plots)",
                    Beautify(
                        (36 *
                            baseCps() *
                            60 *
                            FrozenCookies.harvestMinutes *
                            FrozenCookies.harvestFrenzy *
                            FrozenCookies.harvestBuilding) /
                            Math.pow(10, FrozenCookies.maxSpecials)
                    )
                )
            );
            menu.append(subsection);
        }

        // --- OTHER INFO SECTION ---
        subsection = $("<div>").addClass("subsection");
        subsection.append(
            $("<div>").addClass("title").html("Other Information")
        );
        // Clicks at the rate the clicker measures, 0 with Autoclick off.
        cps = baseCps() + Game.computedMouseCps * MushieCookies.clicksPerSecond(FrozenCookies);
        baseChosen = Game.hasBuff("Frenzy") ? "" : " (*)";
        frenzyChosen = Game.hasBuff("Frenzy") ? " (*)" : "";
        clickStr = FrozenCookies.autoClick ? " + Autoclick" : "";
        subsection.append(
            buildListing("Base CPS" + clickStr + baseChosen + "", Beautify(cps))
        );
        subsection.append(
            buildListing(
                "Frenzy CPS" + clickStr + frenzyChosen + "",
                Beautify(cps * 7)
            )
        );
        subsection.append(
            buildListing("Estimated Effective CPS", Beautify(effectiveCps()))
        );
        if (Game.HasUnlocked("Chocolate egg") && !Game.Has("Chocolate egg")) {
            subsection.append(
                buildListing("Chocolate Egg Value", Beautify(chocolateValue()))
            );
            if (!Game.hasAura("Earth Shatterer")) {
                subsection.append(
                    buildListing(
                        "+ Earth Shatterer",
                        Beautify(chocolateValue(null, true))
                    )
                );
            }
        }
        if (liveWrinklers().length > 0) {
            subsection.append(
                buildListing("Wrinkler Value", Beautify(wrinklerValue()))
            );
        }
        subsection.append(buildListing("Game Seed", Game.seed));
        menu.append(subsection);
        if (!Game.HasAchiev("Olden days"))
            subsection.append(
                $(
                    '<div id="oldenDays" style="text-align:right;width:100%;"><div ' +
                        Game.clickStr +
                        "=\"Game.SparkleAt(Game.mouseX,Game.mouseY);PlaySound('snd/tick.mp3');PlaySound('snd/shimmerClick.mp3');Game.Win('Olden days');Game.UpdateMenu();\" class=\"icon\" style=\"display:inline-block;transform:scale(0.5);cursor:pointer;width:48px;height:48px;background-position:" +
                        -12 * 48 +
                        "px " +
                        -3 * 48 +
                        'px;"></div></div>'
                )
            );
    };
}

// New function for multiple choice options
function setPreferenceDirect(preferenceName, value) {
    var preference = FrozenCookies.preferenceValues[preferenceName];
    if (preference) {
        if (preferenceName === "autopilot") {
            if (value) MushieCookies.applyAutopilot(FrozenCookies);
        } else if (FrozenCookies[preferenceName] !== value) {
            takeOverFromAutopilot(preferenceName);
        }
        FrozenCookies[preferenceName] = value;
        FrozenCookies.recalculateCaches = true;
        Game.RefreshStore();
        Game.RebuildUpgrades();
        FCStart();
    }
}

// Opens the built-in Cookie Clicker log/info panel.
function openGameLogPanel() {
    Game.ShowMenu("log");
}

// Opens the Frozen Cookies online documentation page.
// Note: Modern browsers restrict window.open to only open new tabs or windows as per user settings.
// There is no reliable, cross-browser way to force a new browser instance from JavaScript due to security restrictions.
// The following will open a new window (which may be a tab, depending on browser settings).
function openDocumentationPage() {
    window.open(
        "https://github.com/mushcore/mushie-cookies#readme",
        "_blank",
        "noopener,noreferrer,width=800,height=600"
    );
}
