import { useState } from "react";
import { Button, Modal } from "react-bootstrap";

const BackendSelector: React.FC = () => {
    const [backendHost, setBackendHost] = useState<string>(
        localStorage.getItem("backend-host") || "localhost:8188"
    );
    const [show, setShow] = useState(false);

    const handleSave = () => {
        localStorage.setItem("backend-host", backendHost);
        setShow(false);
    };

    const handleCancel = () => {
        setShow(false);
    };

    return (
        <>
            <Button onClick={() => setShow(true)} style={{ margin: "4px" }}>
                {/* font awesome settings */}
                <i className="fas fa-cog"></i>
            </Button>

            <Modal show={show} onHide={handleCancel}>
                <Modal.Header closeButton>
                    <Modal.Title>Backend Selector</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <input
                        type="text"
                        value={backendHost}
                        onChange={(e) => setBackendHost(e.target.value)}
                    />
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSave}>
                        OK
                    </Button>
                </Modal.Footer>
            </Modal>
        </>
    );
};

export default BackendSelector;
