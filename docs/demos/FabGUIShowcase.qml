import QtQuick
import QtQuick.Window
import QtWebEngine

Window {
    id: showcase
    width: 1200
    height: 675
    minimumWidth: 640
    minimumHeight: 360
    visible: true
    title: "FabGUI — Liquid Glass Showcase"
    color: "#080d1a"

    readonly property int duration: 10000
    property bool ready: false
    property bool playing: !Qt.application.arguments.includes("--paused")
    property double startTime: 0
    property int position: 0
    property string errorMessage: ""

    function draw() {
        web.runJavaScript(`window.drawShowcaseFrame(${position})`)
    }

    function togglePlayback() {
        if (!ready)
            return
        if (!playing)
            startTime = Date.now() - position
        playing = !playing
    }

    Timer {
        interval: 33
        repeat: true
        running: showcase.ready && showcase.playing
        onTriggered: {
            showcase.position = (Date.now() - showcase.startTime) % showcase.duration
            showcase.draw()
        }
    }

    WebEngineView {
        id: web
        anchors.fill: parent
        backgroundColor: showcase.color
        url: Qt.resolvedUrl("glass-showcase.html")
        settings.localContentCanAccessFileUrls: true
        settings.errorPageEnabled: false
        onLoadingChanged: function(request) {
            if (request.status === WebEngineView.LoadFailedStatus) {
                showcase.errorMessage = request.errorString
            } else if (request.status === WebEngineView.LoadSucceededStatus) {
                runJavaScript("typeof window.drawShowcaseFrame === 'function'", function(ready) {
                    if (!ready) {
                        showcase.errorMessage = "The showcase requires WebGL 2 in Qt WebEngine."
                        return
                    }
                    showcase.startTime = Date.now()
                    showcase.ready = true
                    showcase.draw()
                })
            }
        }
    }

    Text {
        anchors.centerIn: parent
        visible: showcase.errorMessage.length > 0
        color: "white"
        text: showcase.errorMessage
    }

    Shortcut {
        sequence: "Space"
        onActivated: showcase.togglePlayback()
    }
    Shortcut {
        sequence: "R"
        onActivated: {
            if (!showcase.ready)
                return
            showcase.position = 0
            showcase.startTime = Date.now()
            showcase.playing = true
            showcase.draw()
        }
    }
}
