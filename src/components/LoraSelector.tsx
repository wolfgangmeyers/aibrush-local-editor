import { FC, useState } from "react";
import { Modal } from "react-bootstrap";
import { SelectedLora } from "../lib/loras";

interface Props {
    loras: string[];
    selectedLoras: string[];
    onClose: () => void;
    onSelect: (lora: SelectedLora) => void;
}

// export interface SelectedLora {
//     name: string;
//     strength: string;
// }

// we're making a modal to add a lora to a list. There needs to be a dropdown,
// and add button, and a remove button for each of the selected loras.
// an ok and cancel button in the footer.
// don't show already selected loras in the dropdown
// allow user to specify strength using a range slider
export const LoraSelector: FC<Props> = ({ loras, selectedLoras, onClose, onSelect }) => {
    const [selectedLora, setSelectedLora] = useState<string>(loras[0]);
    const [strength, setStrength] = useState<number>(1);

    const onAdd = () => {
        onSelect({ name: selectedLora, strength });
    };

    const availableLoras = loras.filter((lora) => !selectedLoras.includes(lora));

    return (
        <Modal show={true} onHide={onClose}>
            <Modal.Header>
                <Modal.Title>Add Lora</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <div className="form-group">
                    <label htmlFor="lora">Lora</label>
                    <select
                        className="form-control"
                        id="lora"
                        value={selectedLora}
                        onChange={(event) => setSelectedLora(event.target.value)}
                    >
                        {availableLoras.map((lora) => (
                            <option key={lora} value={lora}>
                                {lora}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label htmlFor="strength">Strength: {strength}</label>
                    <input
                        type="range"
                        className="form-control-range"
                        id="strength"
                        min="0"
                        max="2"
                        step="0.1"
                        value={strength}
                        onChange={(event) => setStrength(parseFloat(event.target.value))}
                    />
                </div>
            </Modal.Body>
            <Modal.Footer>
                <button type="button" className="btn btn-primary" onClick={onAdd}>
                    Add
                </button>
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                    Cancel
                </button>
            </Modal.Footer>
        </Modal>
    );

};