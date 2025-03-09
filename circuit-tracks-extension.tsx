"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import * as Tone from "tone"
import { WebMidi } from "webmidi"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Play,
  Square,
  Upload,
  Volume2,
  Music,
  AlertCircle,
  CheckCircle2,
  Clock,
  SkipBack,
  SkipForward,
  Trash2,
  Grid,
  Download,
  Link2,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Knob } from "./components/knob"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"

export default function CircuitTracksExtension() {
  // State variables
  const [midiEnabled, setMidiEnabled] = useState(false)
  const [midiInput, setMidiInput] = useState(null)
  const [midiOutput, setMidiOutput] = useState(null)
  const [midiInputs, setMidiInputs] = useState([])
  const [midiOutputs, setMidiOutputs] = useState([])
  const [samples, setSamples] = useState(Array(8).fill(null))
  const [sampleNames, setSampleNames] = useState(Array(8).fill("No sample loaded"))
  const [steps, setSteps] = useState(
    Array(8)
      .fill(null)
      .map(() => Array(16).fill(false)),
  )
  const [playing, setPlaying] = useState(false)
  const [tempo, setTempo] = useState(120)
  const [currentStep, setCurrentStep] = useState(-1)
  const [trackVolumes, setTrackVolumes] = useState(Array(8).fill(0.8))
  const sequenceRef = useRef(null)
  const [midiError, setMidiError] = useState("")
  const [midiClockEnabled, setMidiClockEnabled] = useState(true)
  const [midiClockReceived, setMidiClockReceived] = useState(false)
  const [midiClockTempo, setMidiClockTempo] = useState(120)
  const midiClockTicksRef = useRef(0)
  const midiClockLastTimeRef = useRef(0)
  const midiClockTempoRef = useRef(120)
  const midiClockIntervalRef = useRef(null)
  const midiListenersSetRef = useRef(false)
  const [audioContextStarted, setAudioContextStarted] = useState(false)

  const [trackStepCounts, setTrackStepCounts] = useState(Array(8).fill(16))
  const [trackEffects, setTrackEffects] = useState(
    Array(8)
      .fill()
      .map(() => ({
        filter: {
          cutoff: 1.0,
          resonance: 0.1,
        },
        delay: {
          time: 0.3,
          feedback: 0.3,
          mix: 0.2,
        },
        reverb: {
          size: 0.5,
          mix: 0.2,
        },
      })),
  )
  const [effectsNodes, setEffectsNodes] = useState(Array(8).fill(null))

  // Track-specific transport controls
  const [trackPlaying, setTrackPlaying] = useState(Array(8).fill(false))
  const [trackCurrentSteps, setTrackCurrentSteps] = useState(Array(8).fill(-1))
  const trackSequenceRefs = useRef(Array(8).fill(null))

  const [sampleBank, setSampleBank] = useState(
    Array(4)
      .fill(null)
      .map(() => Array(8).fill(null)),
  )
  const [sampleBankNames, setSampleBankNames] = useState(
    Array(4)
      .fill(null)
      .map(() => Array(8).fill("Empty")),
  )
  const [draggedSample, setDraggedSample] = useState({ row: -1, col: -1 })
  const [isLoading, setIsLoading] = useState(false)

  // Initialisiere Tone.js nur einmal beim ersten Benutzerinteraktion
  const initializeToneJs = useCallback(async () => {
    if (audioContextStarted) return

    try {
      await Tone.start()
      Tone.Transport.bpm.value = tempo
      setAudioContextStarted(true)
      console.log("Tone.js initialized successfully")
    } catch (err) {
      console.error("Failed to initialize Tone.js:", err)
      toast({
        title: "Audio Error",
        description: "Could not initialize audio. Please try again.",
        variant: "destructive",
      })
    }
  }, [audioContextStarted, tempo])

  // MIDI Clock Sync Funktionen
  const calculateTempoFromMIDIClock = () => {
    try {
      const now = performance.now()
      const elapsed = now - midiClockLastTimeRef.current

      // Nur berechnen, wenn genügend Zeit vergangen ist und Ticks empfangen wurden
      if (elapsed > 500 && midiClockTicksRef.current > 0) {
        // MIDI Clock sendet 24 Ticks pro Viertelnote
        // Tempo in BPM = (Ticks / 24) * (60000 / Zeit in ms)
        const ticksPerMinute = (midiClockTicksRef.current / 24) * (60000 / elapsed)

        // Begrenze das Tempo auf sinnvolle Werte (20-300 BPM)
        const newTempo = Math.max(20, Math.min(300, Math.round(ticksPerMinute)))

        // Aktualisiere den Tempo-Referenzwert
        midiClockTempoRef.current = newTempo

        // Aktualisiere den State (aber nicht zu oft, um Rendering-Probleme zu vermeiden)
        setMidiClockTempo(newTempo)

        // Setze die Zähler zurück
        midiClockTicksRef.current = 0
        midiClockLastTimeRef.current = now
      }
    } catch (err) {
      console.error("Error calculating tempo from MIDI clock:", err)
    }
  }

  const handleMIDIClock = () => {
    try {
      // Inkrementiere den Tick-Zähler
      midiClockTicksRef.current++

      // Setze die letzte Zeit, wenn dies der erste Tick ist
      if (midiClockTicksRef.current === 1) {
        midiClockLastTimeRef.current = performance.now()
      }

      // Berechne das Tempo nach jedem 24. Tick (eine Viertelnote)
      if (midiClockTicksRef.current % 24 === 0) {
        calculateTempoFromMIDIClock()
      }

      // Markiere, dass MIDI-Clock empfangen wurde
      if (!midiClockReceived) {
        setMidiClockReceived(true)
      }
    } catch (err) {
      console.error("Error handling MIDI clock:", err)
    }
  }

  // Richte MIDI-Clock-Listener ein
  const setupMIDIClockListeners = useCallback(
    (input) => {
      if (!input) return

      try {
        // Entferne vorhandene Listener
        input.removeListener()

        // MIDI Start-Nachricht
        input.addListener("start", () => {
          console.log("Received MIDI Start")
          if (midiClockEnabled) {
            // Starte die Wiedergabe
            if (audioContextStarted) {
              Tone.Transport.start()
              setPlaying(true)
            } else {
              initializeToneJs().then(() => {
                Tone.Transport.start()
                setPlaying(true)
              })
            }

            // Setze MIDI-Clock-Zähler zurück
            midiClockTicksRef.current = 0
            midiClockLastTimeRef.current = performance.now()
          }
        })

        // MIDI Stop-Nachricht
        input.addListener("stop", () => {
          console.log("Received MIDI Stop")
          if (midiClockEnabled && audioContextStarted) {
            // Stoppe die Wiedergabe
            Tone.Transport.stop()
            setPlaying(false)
            setCurrentStep(-1)

            // Setze MIDI-Clock-Status zurück
            setMidiClockReceived(false)
          }
        })

        // MIDI Continue-Nachricht
        input.addListener("continue", () => {
          console.log("Received MIDI Continue")
          if (midiClockEnabled && audioContextStarted) {
            Tone.Transport.start()
            setPlaying(true)
          }
        })

        // MIDI Clock-Nachricht (Timing)
        input.addListener("clock", () => {
          if (midiClockEnabled) {
            handleMIDIClock()
          }
        })

        // MIDI Song Position Pointer
        input.addListener("songposition", (e) => {
          if (midiClockEnabled && audioContextStarted) {
            // Song Position Pointer gibt die 16tel-Note an
            const sixteenthNote = e.value
            console.log("Received MIDI Song Position:", sixteenthNote)

            // Setze die Position im Transport
            Tone.Transport.position = Tone.Ticks((sixteenthNote * Tone.Transport.PPQ) / 4).toBarsBeatsSixteenths()
          }
        })

        midiListenersSetRef.current = true
        console.log("MIDI clock listeners set up for:", input.name)
      } catch (err) {
        console.error("Error setting up MIDI clock listeners:", err)
      }
    },
    [midiClockEnabled, audioContextStarted, initializeToneJs],
  )

  // Lade ein Sample in die Sample-Bank
  const loadSampleToBank = (rowIndex, colIndex, file) => {
    if (!file) return

    setIsLoading(true)

    try {
      const reader = new FileReader()

      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target.result

          // Erstelle einen neuen Buffer mit dem geladenen Sample
          const buffer = new Tone.Buffer(arrayBuffer, () => {
            try {
              // Sample in die Bank laden
              const newSampleBank = [...sampleBank]

              // Dispose des alten Samples, falls vorhanden
              if (newSampleBank[rowIndex][colIndex]) {
                newSampleBank[rowIndex][colIndex].dispose()
              }

              // Erstelle einen neuen Player mit dem Buffer
              newSampleBank[rowIndex][colIndex] = new Tone.Player(buffer)
              setSampleBank(newSampleBank)

              // Sample-Namen aktualisieren
              const newSampleBankNames = [...sampleBankNames]
              newSampleBankNames[rowIndex][colIndex] = file.name
              setSampleBankNames(newSampleBankNames)

              setIsLoading(false)
              console.log(`Sample loaded to bank [${rowIndex}][${colIndex}]: ${file.name}`)
            } catch (err) {
              console.error("Error creating player:", err)
              setIsLoading(false)
              toast({
                title: "Sample Error",
                description: "Failed to create audio player. Please try another sample.",
                variant: "destructive",
              })
            }
          })

          buffer.onerror = (err) => {
            console.error("Buffer loading error:", err)
            setIsLoading(false)
            toast({
              title: "Sample Error",
              description: "Failed to load sample. The file may be corrupted or in an unsupported format.",
              variant: "destructive",
            })
          }
        } catch (err) {
          console.error("Error processing file:", err)
          setIsLoading(false)
          toast({
            title: "Sample Error",
            description: "Failed to process audio file. Please try another sample.",
            variant: "destructive",
          })
        }
      }

      reader.onerror = () => {
        console.error("FileReader error")
        setIsLoading(false)
        toast({
          title: "File Error",
          description: "Failed to read the file. Please try again.",
          variant: "destructive",
        })
      }

      reader.readAsArrayBuffer(file)
    } catch (err) {
      console.error("Error in loadSampleToBank:", err)
      setIsLoading(false)
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      })
    }
  }

  // Lösche ein Sample aus der Bank
  const clearSampleFromBank = (rowIndex, colIndex) => {
    try {
      const newSampleBank = [...sampleBank]
      if (newSampleBank[rowIndex][colIndex]) {
        newSampleBank[rowIndex][colIndex].dispose()
      }
      newSampleBank[rowIndex][colIndex] = null
      setSampleBank(newSampleBank)

      const newSampleBankNames = [...sampleBankNames]
      newSampleBankNames[rowIndex][colIndex] = "Empty"
      setSampleBankNames(newSampleBankNames)

      console.log(`Sample cleared from bank [${rowIndex}][${colIndex}]`)
    } catch (err) {
      console.error("Error clearing sample:", err)
      toast({
        title: "Error",
        description: "Failed to clear sample. Please try again.",
        variant: "destructive",
      })
    }
  }

  // Drag-and-Drop-Handler
  const handleDragStart = (rowIndex, colIndex) => {
    if (sampleBank[rowIndex][colIndex]) {
      setDraggedSample({ row: rowIndex, col: colIndex })
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault() // Erlaubt das Droppen
  }

  const handleDrop = (trackIndex) => {
    if (draggedSample.row >= 0 && draggedSample.col >= 0) {
      const { row, col } = draggedSample
      if (sampleBank[row][col]) {
        setIsLoading(true)

        try {
          // Klone das Sample aus der Bank
          const sampleBuffer = sampleBank[row][col].buffer.get()

          // Erstelle einen neuen Tone.Buffer mit dem geklonten Sample
          const buffer = new Tone.Buffer(sampleBuffer)

          // Warte, bis der Buffer geladen ist
          buffer.onload = () => {
            try {
              // Erstelle einen Effekt-Chain für den Track
              const inputNode = createEffectsChain(trackIndex)

              // Erstelle einen neuen Player und verbinde ihn mit dem Effekt-Chain
              const newSamples = [...samples]

              // Dispose des alten Samples, falls vorhanden
              if (newSamples[trackIndex]) {
                newSamples[trackIndex].dispose()
              }

              // Erstelle einen neuen Player und verbinde ihn mit dem Effekt-Chain
              newSamples[trackIndex] = new Tone.Player(buffer).connect(inputNode)
              setSamples(newSamples)

              // Aktualisiere den Sample-Namen
              const newSampleNames = [...sampleNames]
              newSampleNames[trackIndex] = sampleBankNames[row][col]
              setSampleNames(newSampleNames)

              setIsLoading(false)
              console.log(`Sample assigned to track ${trackIndex}: ${sampleBankNames[row][col]}`)
            } catch (err) {
              console.error("Error creating player for track:", err)
              setIsLoading(false)
              toast({
                title: "Sample Error",
                description: "Failed to assign sample to track. Please try again.",
                variant: "destructive",
              })
            }
          }

          buffer.onerror = (err) => {
            console.error("Buffer loading error:", err)
            setIsLoading(false)
            toast({
              title: "Sample Error",
              description: "Failed to load sample for track. Please try again.",
              variant: "destructive",
            })
          }
        } catch (err) {
          console.error("Error in handleDrop:", err)
          setIsLoading(false)
          toast({
            title: "Error",
            description: "Failed to assign sample to track. Please try again.",
            variant: "destructive",
          })
        }
      }

      // Zurücksetzen des gezogenen Samples
      setDraggedSample({ row: -1, col: -1 })
    }
  }

  // Spiele ein Sample aus der Bank ab
  const playSampleFromBank = (rowIndex, colIndex) => {
    if (!audioContextStarted) {
      initializeToneJs().then(() => {
        playSampleFromBankInternal(rowIndex, colIndex)
      })
    } else {
      playSampleFromBankInternal(rowIndex, colIndex)
    }
  }

  const playSampleFromBankInternal = (rowIndex, colIndex) => {
    try {
      if (sampleBank[rowIndex][colIndex]) {
        const player = sampleBank[rowIndex][colIndex].clone()
        player.toDestination()
        player.start()

        // Automatisch aufräumen, wenn das Sample fertig ist
        player.onstop = () => {
          player.dispose()
        }
      }
    } catch (err) {
      console.error("Error playing sample:", err)
      toast({
        title: "Playback Error",
        description: "Failed to play sample. Please try again.",
        variant: "destructive",
      })
    }
  }

  // Exportiere alle Samples aus der Bank
  const exportSampleBank = () => {
    try {
      const bankData = {
        samples: sampleBankNames,
      }
      const dataStr = JSON.stringify(bankData, null, 2)
      const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr)

      const exportFileDefaultName = "sample-bank.json"

      const linkElement = document.createElement("a")
      linkElement.setAttribute("href", dataUri)
      linkElement.setAttribute("download", exportFileDefaultName)
      linkElement.click()

      console.log("Sample bank exported successfully")
    } catch (err) {
      console.error("Error exporting sample bank:", err)
      toast({
        title: "Export Error",
        description: "Failed to export sample bank. Please try again.",
        variant: "destructive",
      })
    }
  }

  // Initialize WebMidi
  useEffect(() => {
    const initializeWebMidi = async () => {
      // Check if the WebMidi API is available in this environment
      if (typeof navigator !== "undefined" && "requestMIDIAccess" in navigator) {
        try {
          await WebMidi.enable({ sysex: true })
          console.log("WebMidi enabled!")
          setMidiEnabled(true)

          // Get all available MIDI inputs and outputs
          const inputs = WebMidi.inputs
          const outputs = WebMidi.outputs
          setMidiInputs(inputs)
          setMidiOutputs(outputs)

          // Try to find Circuit Tracks
          const circuitTracksInput = inputs.find(
            (input) => input.name.toLowerCase().includes("circuit") || input.name.toLowerCase().includes("tracks"),
          )

          const circuitTracksOutput = outputs.find(
            (output) => output.name.toLowerCase().includes("circuit") || output.name.toLowerCase().includes("tracks"),
          )

          if (circuitTracksInput) {
            setMidiInput(circuitTracksInput)
            console.log("Circuit Tracks input found and selected:", circuitTracksInput.name)

            // Set up MIDI clock listeners
            setupMIDIClockListeners(circuitTracksInput)
          }

          if (circuitTracksOutput) {
            setMidiOutput(circuitTracksOutput)
            console.log("Circuit Tracks output found and selected:", circuitTracksOutput.name)
          }
        } catch (err) {
          console.error("WebMidi could not be enabled.", err)
          setMidiError(err.message || "MIDI access is not available in this environment")
          // Continue without MIDI functionality
        }
      } else {
        console.log("WebMidi API is not available in this environment")
        setMidiError("WebMidi API is not available in this browser or environment")
      }
    }

    // Try to initialize WebMidi, but continue even if it fails
    initializeWebMidi()

    // Starte ein Intervall, um das Tempo regelmäßig zu aktualisieren
    midiClockIntervalRef.current = setInterval(() => {
      if (midiClockEnabled && midiClockReceived && audioContextStarted) {
        try {
          // Aktualisiere das Tone.js-Tempo basierend auf dem MIDI-Clock-Tempo
          Tone.Transport.bpm.value = midiClockTempoRef.current

          // Aktualisiere den State für die UI
          setTempo(midiClockTempoRef.current)
        } catch (err) {
          console.error("Error updating tempo from MIDI clock:", err)
        }
      }
    }, 100)

    return () => {
      // Clean up
      if (sequenceRef.current) {
        sequenceRef.current.dispose()
      }

      // Clean up track sequences
      if (trackSequenceRefs.current) {
        trackSequenceRefs.current.forEach((seq) => {
          if (seq) seq.dispose()
        })
      }

      // Stoppe das Tempo-Update-Intervall
      if (midiClockIntervalRef.current) {
        clearInterval(midiClockIntervalRef.current)
      }

      // Only disable WebMidi if it was successfully enabled
      if (midiEnabled && typeof WebMidi !== "undefined" && WebMidi.enabled) {
        try {
          // Remove listeners before disabling
          if (midiInput) {
            midiInput.removeListener()
          }
          WebMidi.disable()
        } catch (err) {
          console.error("Error disabling WebMidi:", err)
        }
      }

      // Dispose all audio resources
      try {
        if (audioContextStarted) {
          // Dispose samples
          samples.forEach((sample) => {
            if (sample) sample.dispose()
          })

          // Dispose sample bank
          sampleBank.forEach((row) => {
            row.forEach((sample) => {
              if (sample) sample.dispose()
            })
          })

          // Dispose effects
          effectsNodes.forEach((nodes) => {
            if (nodes) {
              nodes.filter.dispose()
              nodes.delay.dispose()
              nodes.reverb.dispose()
            }
          })
        }
      } catch (err) {
        console.error("Error disposing audio resources:", err)
      }
    }
  }, []) // Leere Dependency-Array, damit dieser Effekt nur einmal ausgeführt wird

  // Reagiere auf Änderungen der MIDI-Clock-Einstellung
  useEffect(() => {
    if (midiInput && midiClockEnabled && !midiListenersSetRef.current) {
      setupMIDIClockListeners(midiInput)
    }
  }, [midiClockEnabled, midiInput, setupMIDIClockListeners])

  // Wähle MIDI-Input
  const selectMidiInput = (inputId) => {
    if (!midiEnabled) return

    try {
      const input = WebMidi.getInputById(inputId)
      if (input) {
        // Entferne Listener vom alten Input
        if (midiInput) {
          midiInput.removeListener()
          midiListenersSetRef.current = false
        }

        // Setze den neuen Input
        setMidiInput(input)

        // Richte Listener für den neuen Input ein
        if (midiClockEnabled) {
          setupMIDIClockListeners(input)
        }
      }
    } catch (err) {
      console.error("Error selecting MIDI input:", err)
      toast({
        title: "MIDI Error",
        description: "Failed to select MIDI input. Please try again.",
        variant: "destructive",
      })
    }
  }

  // Update tempo when changed manually (only if MIDI clock is disabled)
  useEffect(() => {
    if ((!midiClockEnabled || !midiClockReceived) && audioContextStarted) {
      Tone.Transport.bpm.value = tempo
    }
  }, [tempo, midiClockEnabled, midiClockReceived, audioContextStarted])

  // Toggle MIDI Clock Sync
  const toggleMidiClockSync = () => {
    const newState = !midiClockEnabled
    setMidiClockEnabled(newState)

    if (newState) {
      console.log("MIDI Clock Sync enabled")
      // Wenn MIDI-Clock aktiviert wird, setze die Zähler zurück
      midiClockTicksRef.current = 0
      midiClockLastTimeRef.current = performance.now()

      // Richte Listener ein, falls ein Input ausgewählt ist
      if (midiInput) {
        setupMIDIClockListeners(midiInput)
      }
    } else {
      console.log("MIDI Clock Sync disabled")
      setMidiClockReceived(false)

      // Wenn MIDI-Clock deaktiviert wird, setze das Tempo manuell
      if (audioContextStarted) {
        Tone.Transport.bpm.value = tempo
      }
    }
  }

  const createEffectsChain = (trackIndex) => {
    try {
      // Clean up previous effects chain if it exists
      if (effectsNodes[trackIndex]) {
        effectsNodes[trackIndex].filter.dispose()
        effectsNodes[trackIndex].delay.dispose()
        effectsNodes[trackIndex].reverb.dispose()
      }

      // Create new effects
      const filter = new Tone.Filter({
        frequency: trackEffects[trackIndex].filter.cutoff * 20000,
        Q: trackEffects[trackIndex].filter.resonance * 10,
        type: "lowpass",
      })

      const delay = new Tone.FeedbackDelay({
        delayTime: trackEffects[trackIndex].delay.time,
        feedback: trackEffects[trackIndex].delay.feedback,
        wet: trackEffects[trackIndex].delay.mix,
      })

      const reverb = new Tone.Reverb({
        decay: trackEffects[trackIndex].reverb.size * 10,
        wet: trackEffects[trackIndex].reverb.mix,
      })

      // Connect the chain
      filter.connect(delay)
      delay.connect(reverb)
      reverb.toDestination()

      // Store the nodes
      const newEffectsNodes = [...effectsNodes]
      newEffectsNodes[trackIndex] = { filter, delay, reverb }
      setEffectsNodes(newEffectsNodes)

      return filter
    } catch (err) {
      console.error("Error creating effects chain:", err)
      toast({
        title: "Audio Error",
        description: "Failed to create audio effects. Using default settings.",
        variant: "destructive",
      })

      // Fallback: Return a simple filter connected to destination
      const fallbackFilter = new Tone.Filter(20000).toDestination()
      return fallbackFilter
    }
  }

  // Load sample function
  const loadSample = (trackIndex, file) => {
    if (!file) return

    if (!audioContextStarted) {
      initializeToneJs().then(() => {
        loadSampleInternal(trackIndex, file)
      })
    } else {
      loadSampleInternal(trackIndex, file)
    }
  }

  const loadSampleInternal = (trackIndex, file) => {
    setIsLoading(true)

    try {
      const reader = new FileReader()

      reader.onload = (e) => {
        try {
          const arrayBuffer = e.target.result

          // Erstelle einen neuen Buffer mit dem geladenen Sample
          const buffer = new Tone.Buffer(arrayBuffer, () => {
            try {
              // Create effects chain first
              const inputNode = createEffectsChain(trackIndex)

              // Buffer is loaded
              const newSamples = [...samples]

              // Dispose des alten Samples, falls vorhanden
              if (newSamples[trackIndex]) {
                newSamples[trackIndex].dispose()
              }

              // Connect to effects chain instead of destination
              newSamples[trackIndex] = new Tone.Player(buffer).connect(inputNode)
              setSamples(newSamples)

              // Update sample name
              const newSampleNames = [...sampleNames]
              newSampleNames[trackIndex] = file.name
              setSampleNames(newSampleNames)

              setIsLoading(false)
              console.log(`Sample loaded to track ${trackIndex}: ${file.name}`)
            } catch (err) {
              console.error("Error creating player:", err)
              setIsLoading(false)
              toast({
                title: "Sample Error",
                description: "Failed to create audio player. Please try another sample.",
                variant: "destructive",
              })
            }
          })

          buffer.onerror = (err) => {
            console.error("Buffer loading error:", err)
            setIsLoading(false)
            toast({
              title: "Sample Error",
              description: "Failed to load sample. The file may be corrupted or in an unsupported format.",
              variant: "destructive",
            })
          }
        } catch (err) {
          console.error("Error processing file:", err)
          setIsLoading(false)
          toast({
            title: "Sample Error",
            description: "Failed to process audio file. Please try another sample.",
            variant: "destructive",
          })
        }
      }

      reader.onerror = () => {
        console.error("FileReader error")
        setIsLoading(false)
        toast({
          title: "File Error",
          description: "Failed to read the file. Please try again.",
          variant: "destructive",
        })
      }

      reader.readAsArrayBuffer(file)
    } catch (err) {
      console.error("Error in loadSample:", err)
      setIsLoading(false)
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      })
    }
  }

  const updateEffectParam = (trackIndex, effectType, paramName, value) => {
    try {
      const newEffects = [...trackEffects]
      newEffects[trackIndex][effectType][paramName] = value
      setTrackEffects(newEffects)

      // Update the actual effect node if it exists
      if (effectsNodes[trackIndex]) {
        const node = effectsNodes[trackIndex][effectType]

        switch (effectType) {
          case "filter":
            if (paramName === "cutoff") {
              node.frequency.value = value * 20000
            } else if (paramName === "resonance") {
              node.Q.value = value * 10
            }
            break
          case "delay":
            if (paramName === "time") {
              node.delayTime.value = value
            } else if (paramName === "feedback") {
              node.feedback.value = value
            } else if (paramName === "mix") {
              node.wet.value = value
            }
            break
          case "reverb":
            if (paramName === "size") {
              // Reverb size requires rebuilding the reverb
              node.decay = value * 10
              node.generate()
            } else if (paramName === "mix") {
              node.wet.value = value
            }
            break
        }
      }
    } catch (err) {
      console.error("Error updating effect parameter:", err)
    }
  }

  const updateTrackStepCount = (trackIndex, steps) => {
    const newTrackStepCounts = [...trackStepCounts]
    newTrackStepCounts[trackIndex] = Number.parseInt(steps)
    setTrackStepCounts(newTrackStepCounts)
  }

  // Toggle step function
  const toggleStep = (trackIndex, stepIndex) => {
    const newSteps = [...steps]
    newSteps[trackIndex][stepIndex] = !newSteps[trackIndex][stepIndex]
    setSteps(newSteps)
  }

  // Play/stop function for main transport
  const togglePlayback = async () => {
    // Wenn MIDI-Clock aktiviert ist, ignoriere manuelle Steuerung
    if (midiClockEnabled && midiClockReceived) {
      console.log("Cannot manually control transport when MIDI Clock Sync is active")
      return
    }

    try {
      if (!audioContextStarted) {
        await initializeToneJs()
      }

      if (!playing) {
        Tone.Transport.start()
        setPlaying(true)
      } else {
        Tone.Transport.stop()
        setCurrentStep(-1)
        setPlaying(false)
      }
    } catch (err) {
      console.error("Error toggling playback:", err)
      toast({
        title: "Playback Error",
        description: "Failed to control playback. Please try again.",
        variant: "destructive",
      })
    }
  }

  // Track-specific transport controls
  const toggleTrackPlayback = async (trackIndex) => {
    try {
      if (!audioContextStarted) {
        await initializeToneJs()
      }

      const newTrackPlaying = [...trackPlaying]

      if (!newTrackPlaying[trackIndex]) {
        // Start this track
        newTrackPlaying[trackIndex] = true

        // Create a sequence for this track if it doesn't exist
        if (!trackSequenceRefs.current[trackIndex]) {
          createTrackSequence(trackIndex)
        }

        // Start the transport if it's not already running
        if (Tone.Transport.state !== "started") {
          Tone.Transport.start()
        }
      } else {
        // Stop this track
        newTrackPlaying[trackIndex] = false

        // Dispose the sequence
        if (trackSequenceRefs.current[trackIndex]) {
          trackSequenceRefs.current[trackIndex].dispose()
          trackSequenceRefs.current[trackIndex] = null
        }

        // Reset current step for this track
        const newTrackCurrentSteps = [...trackCurrentSteps]
        newTrackCurrentSteps[trackIndex] = -1
        setTrackCurrentSteps(newTrackCurrentSteps)
      }

      setTrackPlaying(newTrackPlaying)
    } catch (err) {
      console.error("Error toggling track playback:", err)
      toast({
        title: "Playback Error",
        description: "Failed to control track playback. Please try again.",
        variant: "destructive",
      })
    }
  }

  const moveTrackStep = (trackIndex, direction) => {
    try {
      if (!audioContextStarted) {
        initializeToneJs().then(() => {
          moveTrackStepInternal(trackIndex, direction)
        })
      } else {
        moveTrackStepInternal(trackIndex, direction)
      }
    } catch (err) {
      console.error("Error moving track step:", err)
    }
  }

  const moveTrackStepInternal = (trackIndex, direction) => {
    try {
      const newTrackCurrentSteps = [...trackCurrentSteps]
      const maxSteps = trackStepCounts[trackIndex]

      if (direction === "forward") {
        newTrackCurrentSteps[trackIndex] = (newTrackCurrentSteps[trackIndex] + 1) % maxSteps
      } else {
        newTrackCurrentSteps[trackIndex] =
          newTrackCurrentSteps[trackIndex] <= 0 ? maxSteps - 1 : newTrackCurrentSteps[trackIndex] - 1
      }

      setTrackCurrentSteps(newTrackCurrentSteps)

      // Play the sample if there's a step at this position
      if (steps[trackIndex][newTrackCurrentSteps[trackIndex]] && samples[trackIndex]) {
        const player = samples[trackIndex].clone()
        player.volume.value = Tone.gainToDb(trackVolumes[trackIndex])
        player.start()

        // Automatisch aufräumen, wenn das Sample fertig ist
        player.onstop = () => {
          player.dispose()
        }

        // Send MIDI for the first 4 tracks (drum tracks on Circuit) if MIDI is enabled
        if (trackIndex < 4 && midiEnabled && midiOutput) {
          try {
            const channel = 10 // MIDI-Kanal 10 (9 in 0-basierter Zählung) ist der Standard-Drumkanal
            const note = 36 + trackIndex // Bassdrum (36), Snare (38), etc.
            const velocity = Math.round(trackVolumes[trackIndex] * 127)

            midiOutput.playNote(note, channel, { velocity })

            // Schedule note off
            setTimeout(() => {
              midiOutput.stopNote(note, channel)
            }, Tone.Time("16n").toSeconds() * 1000)
          } catch (err) {
            console.error("MIDI output error:", err)
          }
        }
      }
    } catch (err) {
      console.error("Error in moveTrackStepInternal:", err)
    }
  }

  const createTrackSequence = (trackIndex) => {
    try {
      // Dispose existing sequence if it exists
      if (trackSequenceRefs.current[trackIndex]) {
        trackSequenceRefs.current[trackIndex].dispose()
      }

      // Create a new sequence for this track
      trackSequenceRefs.current[trackIndex] = new Tone.Sequence(
        (time, stepIndex) => {
          // Only update if this track is playing
          if (trackPlaying[trackIndex]) {
            // Update current step for this track
            const newTrackCurrentSteps = [...trackCurrentSteps]
            newTrackCurrentSteps[trackIndex] = stepIndex
            setTrackCurrentSteps(newTrackCurrentSteps)

            // Only process this step if it's within the track's step count
            if (stepIndex < trackStepCounts[trackIndex]) {
              if (steps[trackIndex][stepIndex] && samples[trackIndex]) {
                // Play sample with current volume
                const player = samples[trackIndex].clone()
                player.volume.value = Tone.gainToDb(trackVolumes[trackIndex])
                player.start(time)

                // Automatisch aufräumen, wenn das Sample fertig ist
                player.onstop = () => {
                  player.dispose()
                }
              }

              // Send MIDI for the first 4 tracks (drum tracks on Circuit) if MIDI is enabled
              if (trackIndex < 4 && midiEnabled && midiOutput && steps[trackIndex][stepIndex]) {
                try {
                  const channel = 10 // MIDI-Kanal 10 (9 in 0-basierter Zählung) ist der Standard-Drumkanal
                  const note = 36 + trackIndex // Bassdrum (36), Snare (38), etc.
                  const velocity = Math.round(trackVolumes[trackIndex] * 127)

                  midiOutput.playNote(note, channel, { velocity })

                  // Schedule note off
                  Tone.Transport.schedule(
                    (scheduleTime) => {
                      midiOutput.stopNote(note, channel)
                    },
                    `+${Tone.Time("16n").toSeconds()}`,
                  )
                } catch (err) {
                  console.error("MIDI output error:", err)
                }
              }
            }
          }
        },
        Array.from({ length: 16 }, (_, i) => i),
        "16n",
      ).start(0)

      return trackSequenceRefs.current[trackIndex]
    } catch (err) {
      console.error("Error creating track sequence:", err)
      return null
    }
  }

  // Update track volume
  const updateTrackVolume = (trackIndex, value) => {
    const newVolumes = [...trackVolumes]
    newVolumes[trackIndex] = value[0]
    setTrackVolumes(newVolumes)
  }

  // Select MIDI output
  const selectMidiOutput = (outputId) => {
    if (!midiEnabled) return

    try {
      const output = WebMidi.getOutputById(outputId)
      if (output) {
        setMidiOutput(output)
        console.log("MIDI output selected:", output.name)
      }
    } catch (err) {
      console.error("Error selecting MIDI output:", err)
      toast({
        title: "MIDI Error",
        description: "Failed to select MIDI output. Please try again.",
        variant: "destructive",
      })
    }
  }

  // Main sequencer for global transport
  useEffect(() => {
    if (!audioContextStarted) return

    try {
      if (sequenceRef.current) {
        sequenceRef.current.dispose()
      }

      sequenceRef.current = new Tone.Sequence(
        (time, stepIndex) => {
          setCurrentStep(stepIndex)

          for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
            // Skip tracks that have their own transport active
            if (trackPlaying[trackIndex]) continue

            // Only process this step if it's within the track's step count
            if (stepIndex < trackStepCounts[trackIndex]) {
              if (steps[trackIndex][stepIndex] && samples[trackIndex]) {
                // Play sample with current volume
                const player = samples[trackIndex].clone()
                player.volume.value = Tone.gainToDb(trackVolumes[trackIndex])
                player.start(time)

                // Automatisch aufräumen, wenn das Sample fertig ist
                player.onstop = () => {
                  player.dispose()
                }
              }

              // Send MIDI for the first 4 tracks (drum tracks on Circuit) if MIDI is enabled
              if (trackIndex < 4 && midiEnabled && midiOutput && steps[trackIndex][stepIndex]) {
                try {
                  const channel = 10 // MIDI-Kanal 10 (9 in 0-basierter Zählung) ist der Standard-Drumkanal
                  const note = 36 + trackIndex // Bassdrum (36), Snare (38), etc.
                  const velocity = Math.round(trackVolumes[trackIndex] * 127)

                  midiOutput.playNote(note, channel, { velocity })

                  // Schedule note off
                  Tone.Transport.schedule(
                    (scheduleTime) => {
                      midiOutput.stopNote(note, channel)
                    },
                    `+${Tone.Time("16n").toSeconds()}`,
                  )
                } catch (err) {
                  console.error("MIDI output error:", err)
                }
              }
            }
          }
        },
        Array.from({ length: 16 }, (_, i) => i),
        "16n",
      ).start(0)

      return () => {
        if (sequenceRef.current) {
          sequenceRef.current.dispose()
        }
      }
    } catch (err) {
      console.error("Error creating main sequence:", err)
    }
  }, [steps, samples, midiOutput, trackVolumes, trackStepCounts, trackPlaying, midiEnabled, audioContextStarted])

  return (
    <div className="container mx-auto p-4 max-w-6xl bg-black text-purple-50">
      <Card className="mb-6 bg-zinc-900 border-purple-500/30">
        <CardHeader className="bg-zinc-950/50 border-b border-purple-500/20">
          <CardTitle className="flex items-center justify-between text-purple-50">
            <div className="flex items-center gap-2">
              <Music className="h-6 w-6 text-purple-400" />
              Circuit Tracks Web Extension
            </div>
            <div className="flex items-center gap-2 text-sm font-normal">
              {midiEnabled ? (
                <span className="flex items-center text-purple-400">
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  MIDI Enabled
                </span>
              ) : (
                <span className="flex items-center text-amber-400">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  MIDI Disabled
                </span>
              )}

              {midiClockReceived && (
                <span className="flex items-center text-green-400">
                  <Clock className="h-4 w-4 mr-1" />
                  MIDI Clock: {midiClockTempo} BPM
                </span>
              )}

              {midiInput ? (
                <span className="flex items-center text-purple-400">
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  In: {midiInput.name}
                </span>
              ) : (
                <span className="flex items-center text-amber-400">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  No MIDI Input
                </span>
              )}

              {midiOutput ? (
                <span className="flex items-center text-purple-400">
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Out: {midiOutput.name}
                </span>
              ) : (
                <span className="flex items-center text-amber-400">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  No MIDI Output
                </span>
              )}
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-center mb-6">
            <Button
              onClick={togglePlayback}
              className={`w-24 ${midiClockEnabled && midiClockReceived ? "opacity-50 cursor-not-allowed" : "bg-purple-600 hover:bg-purple-700"} text-white`}
              variant={playing ? "destructive" : "default"}
              disabled={midiClockEnabled && midiClockReceived}
            >
              {playing ? <Square className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {playing ? "Stop" : "Play"}
            </Button>

            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-purple-200">Tempo:</span>
              <input
                type="number"
                value={tempo}
                onChange={(e) => setTempo(Number.parseInt(e.target.value) || 120)}
                className={`w-16 px-2 py-1 border rounded bg-zinc-800 text-purple-100 border-purple-500/30 ${midiClockEnabled && midiClockReceived ? "opacity-50 cursor-not-allowed" : ""}`}
                min="60"
                max="200"
                disabled={midiClockEnabled && midiClockReceived}
              />
              <span className="text-sm text-purple-300">BPM</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center space-x-2">
                <Switch id="midi-clock" checked={midiClockEnabled} onCheckedChange={toggleMidiClockSync} />
                <Label htmlFor="midi-clock" className="text-sm font-medium text-purple-200">
                  MIDI Clock Sync
                </Label>
              </div>
            </div>

            {midiEnabled && (
              <>
                {midiInputs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-purple-200">MIDI Input:</span>
                    <select
                      className="px-2 py-1 border rounded bg-zinc-800 text-purple-100 border-purple-500/30"
                      onChange={(e) => selectMidiInput(e.target.value)}
                      value={midiInput?.id || ""}
                    >
                      <option value="">Select MIDI Input</option>
                      {midiInputs.map((input) => (
                        <option key={input.id} value={input.id}>
                          {input.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {midiOutputs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-purple-200">MIDI Output:</span>
                    <select
                      className="px-2 py-1 border rounded bg-zinc-800 text-purple-100 border-purple-500/30"
                      onChange={(e) => selectMidiOutput(e.target.value)}
                      value={midiOutput?.id || ""}
                    >
                      <option value="">Select MIDI Output</option>
                      {midiOutputs.map((output) => (
                        <option key={output.id} value={output.id}>
                          {output.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
          </div>

          {!midiEnabled && (
            <Alert variant="warning" className="mb-4 bg-amber-900/20 text-amber-200 border-amber-500/50">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>MIDI Not Available</AlertTitle>
              <AlertDescription>
                {midiError || "WebMIDI is not available in this environment."}
                <p className="mt-1">
                  The sequencer will work with audio samples only. MIDI output functionality is disabled.
                </p>
                <p className="mt-1 text-xs">
                  Note: To use MIDI features, you need to run this application in a compatible browser with appropriate
                  permissions.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {midiEnabled && midiClockEnabled && !midiClockReceived && (
            <Alert className="mb-4 bg-blue-900/20 text-blue-200 border-blue-500/50">
              <Link2 className="h-4 w-4" />
              <AlertTitle>Waiting for MIDI Clock</AlertTitle>
              <AlertDescription>
                MIDI Clock Sync is enabled, but no clock signal has been received yet.
                <p className="mt-1">Start your Circuit Tracks or other MIDI clock source to synchronize the tempo.</p>
              </AlertDescription>
            </Alert>
          )}

          <Card className="mb-6 bg-zinc-900 border-purple-500/30">
            <CardHeader className="bg-zinc-950/50 border-b border-purple-500/20">
              <CardTitle className="flex items-center justify-between text-purple-50">
                <div className="flex items-center gap-2">
                  <Grid className="h-5 w-5 text-purple-400" />
                  Sample Bank
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-zinc-800 border-purple-500/30 text-purple-100 hover:bg-purple-900/50"
                  onClick={exportSampleBank}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Export Bank
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-8 gap-2">
                {sampleBank.map((row, rowIndex) =>
                  row.map((sample, colIndex) => (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      className={`relative p-2 h-20 border rounded-md ${
                        sample ? "bg-zinc-800 border-purple-500/40" : "bg-zinc-900 border-zinc-800"
                      } flex flex-col items-center justify-between cursor-pointer transition-colors hover:bg-zinc-800`}
                      draggable={!!sample}
                      onDragStart={() => handleDragStart(rowIndex, colIndex)}
                      onClick={() => playSampleFromBank(rowIndex, colIndex)}
                    >
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                        {sample ? (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-full bg-zinc-900/80 hover:bg-red-900/80"
                              onClick={(e) => {
                                e.stopPropagation()
                                clearSampleFromBank(rowIndex, colIndex)
                              }}
                            >
                              <Trash2 className="h-3 w-3 text-red-400" />
                              <span className="sr-only">Delete</span>
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 rounded-full bg-zinc-900/80 hover:bg-purple-900/80"
                            asChild
                          >
                            <label>
                              <Upload className="h-3 w-3 text-purple-400" />
                              <span className="sr-only">Upload</span>
                              <input
                                type="file"
                                accept=".wav,.mp3"
                                className="sr-only"
                                onChange={(e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    loadSampleToBank(rowIndex, colIndex, e.target.files[0])
                                  }
                                }}
                              />
                            </label>
                          </Button>
                        )}
                      </div>
                      <div className="text-xs text-center truncate w-full text-purple-200 mt-auto">
                        {sample ? sampleBankNames[rowIndex][colIndex] : "Empty"}
                      </div>
                    </div>
                  )),
                )}
              </div>
              <div className="mt-4 text-xs text-purple-300 text-center">
                Klicke auf einen Slot, um ein Sample zu laden oder abzuspielen. Ziehe Samples auf die Tracks, um sie zu
                verwenden.
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="sequencer" className="text-purple-100">
            <TabsList className="mb-4 bg-zinc-800">
              <TabsTrigger
                value="sequencer"
                className="data-[state=active]:bg-purple-700 data-[state=active]:text-white"
              >
                Sequencer
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="data-[state=active]:bg-purple-700 data-[state=active]:text-white"
              >
                Settings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sequencer" className="space-y-6">
              {!midiEnabled && (
                <div className="p-3 bg-purple-900/20 border border-purple-500/30 rounded-md mb-4">
                  <p className="text-purple-200 text-sm">
                    <span className="font-medium">Running in Audio-Only Mode:</span> MIDI functionality is not available
                    in this environment. You can still use all sequencer features with audio samples.
                  </p>
                </div>
              )}
              {isLoading && (
                <div className="p-3 bg-blue-900/20 border border-blue-500/30 rounded-md mb-4">
                  <p className="text-blue-200 text-sm flex items-center">
                    <span className="mr-2 animate-spin">⏳</span>
                    <span className="font-medium">Loading audio...</span> Please wait while the sample is being
                    processed.
                  </p>
                </div>
              )}
              {samples.map((sample, trackIndex) => (
                <div
                  key={trackIndex}
                  className="border rounded-md p-4 border-purple-500/20 bg-zinc-900 mb-6"
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(trackIndex)}
                >
                  <div className="flex flex-wrap items-center gap-4 mb-3">
                    <h3 className="text-lg font-medium w-24 text-purple-200">Track {trackIndex + 1}</h3>

                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="relative overflow-hidden bg-zinc-800 border-purple-500/30 text-purple-100 hover:bg-purple-900/50"
                          asChild
                        >
                          <label>
                            <Upload className="h-4 w-4 mr-1" />
                            Load Sample
                            <input
                              type="file"
                              accept=".wav,.mp3"
                              className="sr-only"
                              onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                  loadSample(trackIndex, e.target.files[0])
                                }
                              }}
                            />
                          </label>
                        </Button>
                        <span
                          className="text-sm truncate max-w-[200px] text-purple-200"
                          title={sampleNames[trackIndex]}
                        >
                          {sampleNames[trackIndex]}
                        </span>
                      </div>
                    </div>

                    {/* Track Transport Section */}
                    <div className="flex-1 min-w-[200px] bg-zinc-950 p-2 rounded-md border border-purple-500/20">
                      <div className="flex flex-col">
                        <span className="text-xs text-purple-300 mb-2 font-medium">Transport</span>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-purple-200 hover:text-purple-100 hover:bg-purple-900/30"
                              onClick={() => moveTrackStep(trackIndex, "backward")}
                            >
                              <SkipBack className="h-4 w-4 mr-1" />
                              <span className="text-xs">Zurück</span>
                            </Button>

                            <Button
                              size="sm"
                              variant={trackPlaying[trackIndex] ? "destructive" : "default"}
                              className={`h-8 px-3 ${trackPlaying[trackIndex] ? "bg-red-600 hover:bg-red-700 text-white" : "bg-purple-600 hover:bg-purple-700 text-white"}`}
                              onClick={() => toggleTrackPlayback(trackIndex)}
                            >
                              {trackPlaying[trackIndex] ? (
                                <Square className="h-4 w-4 mr-1" />
                              ) : (
                                <Play className="h-4 w-4 mr-1" />
                              )}
                              <span className="text-xs">{trackPlaying[trackIndex] ? "Stop" : "Play"}</span>
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-purple-200 hover:text-purple-100 hover:bg-purple-900/30"
                              onClick={() => moveTrackStep(trackIndex, "forward")}
                            >
                              <SkipForward className="h-4 w-4 mr-1" />
                              <span className="text-xs">Vor</span>
                            </Button>
                          </div>

                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-purple-400" />
                            <Select
                              value={trackStepCounts[trackIndex].toString()}
                              onValueChange={(value) => updateTrackStepCount(trackIndex, value)}
                            >
                              <SelectTrigger className="w-[80px] h-8 bg-zinc-800 border-purple-500/30 text-purple-100">
                                <SelectValue placeholder="Steps" />
                              </SelectTrigger>
                              <SelectContent className="bg-zinc-800 border-purple-500/30 text-purple-100">
                                {[4, 8, 12, 16].map((count) => (
                                  <SelectItem key={count} value={count.toString()}>
                                    {count} steps
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step sequencer grid */}
                  <div className="grid grid-cols-4 xs:grid-cols-8 sm:grid-cols-16 gap-1 mb-4">
                    {steps[trackIndex].map((step, stepIndex) => (
                      <TooltipProvider key={stepIndex}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              className={`w-full aspect-square rounded-sm transition-colors ${
                                stepIndex >= trackStepCounts[trackIndex]
                                  ? "bg-zinc-900 opacity-30 cursor-not-allowed"
                                  : step
                                    ? "bg-purple-600 hover:bg-purple-700"
                                    : "bg-zinc-800 hover:bg-zinc-700"
                              } ${
                                (
                                  currentStep === stepIndex &&
                                    playing &&
                                    !trackPlaying[trackIndex] &&
                                    stepIndex < trackStepCounts[trackIndex]
                                ) ||
                                (
                                  trackCurrentSteps[trackIndex] === stepIndex &&
                                    trackPlaying[trackIndex] &&
                                    stepIndex < trackStepCounts[trackIndex]
                                )
                                  ? "ring-2 ring-offset-1 ring-purple-400 ring-offset-zinc-900"
                                  : ""
                              }`}
                              onClick={() =>
                                stepIndex < trackStepCounts[trackIndex] && toggleStep(trackIndex, stepIndex)
                              }
                              disabled={stepIndex >= trackStepCounts[trackIndex]}
                            >
                              <span className="sr-only">Step {stepIndex + 1}</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="bg-zinc-800 text-purple-100 border-purple-500/30">
                            <p>Step {stepIndex + 1}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                  </div>

                  {/* Effects section */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 p-2 bg-zinc-950 rounded-md">
                    {/* Volume */}
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs text-purple-300 mb-1">Volume</span>
                      <div className="flex items-center justify-center">
                        <Volume2 className="h-4 w-4 text-purple-400 mr-2" />
                        <Slider
                          value={[trackVolumes[trackIndex]]}
                          min={0}
                          max={1}
                          step={0.01}
                          onValueChange={(value) => updateTrackVolume(trackIndex, value)}
                          className="w-24 [&>span:first-child]:bg-zinc-700 [&>span:first-child_span]:bg-purple-500 [&_[role=slider]]:bg-purple-400"
                        />
                      </div>
                    </div>

                    {/* Filter */}
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-purple-300 mb-1">Filter</span>
                      <div className="flex items-center justify-center gap-4">
                        <div className="flex flex-col items-center">
                          <Knob
                            value={trackEffects[trackIndex].filter.cutoff}
                            onChange={(value) => updateEffectParam(trackIndex, "filter", "cutoff", value)}
                            min={0}
                            max={1}
                            size={40}
                            color="#a855f7"
                            className="mb-1"
                          />
                          <span className="text-xs text-purple-200">Cutoff</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <Knob
                            value={trackEffects[trackIndex].filter.resonance}
                            onChange={(value) => updateEffectParam(trackIndex, "filter", "resonance", value)}
                            min={0}
                            max={1}
                            size={40}
                            color="#a855f7"
                            className="mb-1"
                          />
                          <span className="text-xs text-purple-200">Res</span>
                        </div>
                      </div>
                    </div>

                    {/* Delay */}
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-purple-300 mb-1">Delay</span>
                      <div className="flex items-center justify-center gap-2">
                        <div className="flex flex-col items-center">
                          <Knob
                            value={trackEffects[trackIndex].delay.time}
                            onChange={(value) => updateEffectParam(trackIndex, "delay", "time", value)}
                            min={0}
                            max={1}
                            size={40}
                            color="#a855f7"
                            className="mb-1"
                          />
                          <span className="text-xs text-purple-200">Time</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <Knob
                            value={trackEffects[trackIndex].delay.feedback}
                            onChange={(value) => updateEffectParam(trackIndex, "delay", "feedback", value)}
                            min={0}
                            max={0.9}
                            size={40}
                            color="#a855f7"
                            className="mb-1"
                          />
                          <span className="text-xs text-purple-200">Fdbk</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <Knob
                            value={trackEffects[trackIndex].delay.mix}
                            onChange={(value) => updateEffectParam(trackIndex, "delay", "mix", value)}
                            min={0}
                            max={1}
                            size={40}
                            color="#a855f7"
                            className="mb-1"
                          />
                          <span className="text-xs text-purple-200">Mix</span>
                        </div>
                      </div>
                    </div>

                    {/* Reverb */}
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-purple-300 mb-1">Reverb</span>
                      <div className="flex items-center justify-center gap-4">
                        <div className="flex flex-col items-center">
                          <Knob
                            value={trackEffects[trackIndex].reverb.size}
                            onChange={(value) => updateEffectParam(trackIndex, "reverb", "size", value)}
                            min={0}
                            max={1}
                            size={40}
                            color="#a855f7"
                            className="mb-1"
                          />
                          <span className="text-xs text-purple-200">Size</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <Knob
                            value={trackEffects[trackIndex].reverb.mix}
                            onChange={(value) => updateEffectParam(trackIndex, "reverb", "mix", value)}
                            min={0}
                            max={1}
                            size={40}
                            color="#a855f7"
                            className="mb-1"
                          />
                          <span className="text-xs text-purple-200">Mix</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="settings">
              <Card className="bg-zinc-900 border-purple-500/20">
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-medium mb-2 text-purple-200">MIDI Settings</h3>
                      <p className="text-sm text-purple-300 mb-2">
                        Configure how the sequencer interacts with your Circuit Tracks.
                      </p>

                      <div className="space-y-2">
                        <div className="flex items-center">
                          <Switch
                            id="midiClockSync"
                            checked={midiClockEnabled}
                            onCheckedChange={toggleMidiClockSync}
                            disabled={!midiEnabled}
                            className="mr-2"
                          />
                          <label
                            htmlFor="midiClockSync"
                            className={`text-sm ${midiEnabled ? "text-purple-200" : "text-purple-400 opacity-50"}`}
                          >
                            Sync to incoming MIDI clock (Circuit as master)
                          </label>
                        </div>

                        <div className="flex items-center">
                          <input
                            type="checkbox"
                            id="midiThru"
                            className="mr-2 accent-purple-600"
                            disabled={!midiEnabled}
                          />
                          <label
                            htmlFor="midiThru"
                            className={`text-sm ${midiEnabled ? "text-purple-200" : "text-purple-400 opacity-50"}`}
                          >
                            MIDI Thru (pass incoming MIDI to output)
                          </label>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-medium mb-2 text-purple-200">Pattern Settings</h3>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-zinc-800 border-purple-500/30 text-purple-100 hover:bg-purple-900/50"
                        >
                          Save Pattern
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-zinc-800 border-purple-500/30 text-purple-100 hover:bg-purple-900/50"
                        >
                          Load Pattern
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-zinc-800 border-purple-500/30 text-purple-100 hover:bg-purple-900/50"
                        >
                          Clear All
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

