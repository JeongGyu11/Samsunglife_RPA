function (element, input) {
    "use strict";

    function createResult(success, operation, elementId, message) {
        return JSON.stringify({
            success: success,
            operation: operation || "",
            element_id: elementId || "",
            message: message || ""
        });
    }

    function escapeAttributeValue(value) {
        return String(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
    }

    function findInRoot(root, elementId) {
        if (!root || !elementId) {
            return null;
        }

        var selector =
            '[data-rpa-element-id="' +
            escapeAttributeValue(elementId) +
            '"]';

        try {
            var directMatch = root.querySelector(selector);

            if (directMatch) {
                return directMatch;
            }
        } catch (queryError) {
            return null;
        }

        var allElements;

        try {
            allElements = root.querySelectorAll("*");
        } catch (allElementsError) {
            return null;
        }

        for (var i = 0; i < allElements.length; i++) {
            var currentElement = allElements[i];

            if (currentElement.shadowRoot) {
                var shadowMatch = findInRoot(
                    currentElement.shadowRoot,
                    elementId
                );

                if (shadowMatch) {
                    return shadowMatch;
                }
            }

            var tagName = String(
                currentElement.tagName || ""
            ).toUpperCase();

            if (
                tagName === "IFRAME" ||
                tagName === "FRAME"
            ) {
                try {
                    var frameDocument =
                        currentElement.contentDocument ||
                        (
                            currentElement.contentWindow
                                ? currentElement.contentWindow.document
                                : null
                        );

                    var frameMatch = findInRoot(
                        frameDocument,
                        elementId
                    );

                    if (frameMatch) {
                        return frameMatch;
                    }
                } catch (frameAccessError) {
                    // 다른 Origin의 iframe은 브라우저 보안 정책상 접근할 수 없습니다.
                }
            }
        }

        return null;
    }

    function isDisabled(target) {
        if (!target) {
            return true;
        }

        if (target.disabled === true) {
            return true;
        }

        var ariaDisabled = String(
            target.getAttribute("aria-disabled") || ""
        ).toLowerCase();

        return ariaDisabled === "true";
    }

    function dispatchEventSafe(target, eventName) {
        try {
            target.dispatchEvent(
                new Event(eventName, {
                    bubbles: true,
                    cancelable: true
                })
            );
        } catch (eventError) {
            // 이벤트 생성 실패 자체로 액션 전체를 실패시키지는 않습니다.
        }
    }

    function setNativeValue(target, value) {
        var tagName = String(
            target.tagName || ""
        ).toUpperCase();

        if (tagName === "INPUT") {
            var inputDescriptor =
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    "value"
                );

            if (
                inputDescriptor &&
                typeof inputDescriptor.set === "function"
            ) {
                inputDescriptor.set.call(target, value);
            } else {
                target.value = value;
            }

            return;
        }

        if (tagName === "TEXTAREA") {
            var textareaDescriptor =
                Object.getOwnPropertyDescriptor(
                    window.HTMLTextAreaElement.prototype,
                    "value"
                );

            if (
                textareaDescriptor &&
                typeof textareaDescriptor.set === "function"
            ) {
                textareaDescriptor.set.call(target, value);
            } else {
                target.value = value;
            }

            return;
        }

        if (target.isContentEditable) {
            target.textContent = value;
            return;
        }

        if ("value" in target) {
            target.value = value;
            return;
        }

        throw new Error(
            "선택된 요소는 값을 입력할 수 있는 요소가 아닙니다."
        );
    }

    try {
        var request;

        try {
            request = JSON.parse(
                String(input || "{}")
            );
        } catch (parseError) {
            return createResult(
                false,
                "",
                "",
                "JS 액션 요청 JSON 파싱에 실패했습니다: " +
                    parseError.message
            );
        }

        var operation = String(
            request.operation || ""
        ).trim().toUpperCase();

        var elementId = String(
            request.element_id || ""
        ).trim();

        var inputValue =
            request.value === null ||
            request.value === undefined
                ? ""
                : String(request.value);

        if (!elementId) {
            return createResult(
                false,
                operation,
                elementId,
                "element_id가 비어 있습니다."
            );
        }

        if (
            operation !== "CLICK" &&
            operation !== "TYPE_INTO" &&
            operation !== "SELECT_OPTION"
        ) {
            return createResult(
                false,
                operation,
                elementId,
                "지원하지 않는 operation입니다."
            );
        }

        var target = findInRoot(
            document,
            elementId
        );

        if (!target) {
            return createResult(
                false,
                operation,
                elementId,
                "선택된 element_id에 해당하는 DOM 요소를 찾지 못했습니다."
            );
        }

        if (isDisabled(target)) {
            return createResult(
                false,
                operation,
                elementId,
                "선택된 DOM 요소가 비활성화되어 있습니다."
            );
        }

        try {
            target.scrollIntoView({
                behavior: "auto",
                block: "center",
                inline: "center"
            });
        } catch (scrollError) {
            try {
                target.scrollIntoView();
            } catch (ignoredScrollError) {
                // 스크롤 실패만으로 액션을 중단하지 않습니다.
            }
        }

        if (operation === "CLICK") {
            if (typeof target.click !== "function") {
                return createResult(
                    false,
                    operation,
                    elementId,
                    "선택된 DOM 요소에 click 함수를 사용할 수 없습니다."
                );
            }

            // Click target directly
            target.click();

            // Dispatch full event sequence for Vue/React/WebSquare reactivity
            dispatchEventSafe(target, "mousedown");
            dispatchEventSafe(target, "mouseup");
            dispatchEventSafe(target, "click");
            dispatchEventSafe(target, "change");

            // Avoid double-clicking parent element which toggles dropdowns closed
            /* if (target.parentElement) {
                var parentTag = String(target.parentElement.tagName || "").toUpperCase();
                if (parentTag === "A" || parentTag === "LI" || parentTag === "DIV" || parentTag === "BUTTON") {
                    try {
                        if (typeof target.parentElement.click === "function") {
                            target.parentElement.click();
                        }
                        dispatchEventSafe(target.parentElement, "change");
                    } catch (pErr) {}
                }
            } */

            return createResult(
                true,
                operation,
                elementId,
                "CLICK 액션을 수행했습니다."
            );
        }

        if (operation === "TYPE_INTO") {
            try {
                target.focus();
            } catch (typeFocusError) {
                // 아래 값 설정을 계속 수행합니다.
            }

            setNativeValue(
                target,
                inputValue
            );

            dispatchEventSafe(
                target,
                "input"
            );

            dispatchEventSafe(
                target,
                "change"
            );

            return createResult(
                true,
                operation,
                elementId,
                "TYPE_INTO 액션을 수행했습니다."
            );
        }

        if (operation === "SELECT_OPTION") {
            var selectTarget = target;
            var targetTag = String(selectTarget.tagName || "").toUpperCase();

            if (targetTag !== "SELECT") {
                try {
                    selectTarget = target.querySelector("select");
                } catch (selectQueryError) {
                    selectTarget = null;
                }
            }

            if (!selectTarget || String(selectTarget.tagName || "").toUpperCase() !== "SELECT") {
                return createResult(false, operation, elementId, "선택된 요소가 SELECT 컨트롤이 아닙니다.");
            }

            var matchedIndex = -1;
            for (var optionIndex = 0; optionIndex < selectTarget.options.length; optionIndex++) {
                var optionText = String(selectTarget.options[optionIndex].text || selectTarget.options[optionIndex].textContent || "").trim();
                var optionValue = String(selectTarget.options[optionIndex].value || "").trim();
                if (optionText === inputValue.trim() || optionValue === inputValue.trim()) {
                    matchedIndex = optionIndex;
                    break;
                }
            }

            if (matchedIndex < 0) {
                return createResult(false, operation, elementId, "요청한 옵션을 찾지 못했습니다: " + inputValue);
            }

            var matchedOption = selectTarget.options[matchedIndex];
            var selectDescriptor = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
            if (selectDescriptor && typeof selectDescriptor.set === "function") {
                selectDescriptor.set.call(selectTarget, matchedOption.value);
            } else {
                selectTarget.selectedIndex = matchedIndex;
                selectTarget.value = matchedOption.value;
            }
            matchedOption.selected = true;
            dispatchEventSafe(selectTarget, "input");
            dispatchEventSafe(selectTarget, "change");

            var actualText = String(selectTarget.options[selectTarget.selectedIndex].text || "").trim();
            if (actualText !== String(matchedOption.text || matchedOption.textContent || "").trim()) {
                return createResult(false, operation, elementId, "옵션 선택 후 검증에 실패했습니다. actual=" + actualText);
            }

            return createResult(true, operation, elementId, "SELECT_OPTION 액션을 수행했습니다. value=" + actualText);
        }

        return createResult(
            false,
            operation,
            elementId,
            "실행 가능한 액션 분기를 찾지 못했습니다."
        );
    } catch (error) {
        return createResult(
            false,
            "",
            "",
            error && error.message
                ? error.message
                : String(error)
        );
    }
}
