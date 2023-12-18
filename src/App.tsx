import './App.css';
import "./bootstrap.min.css";
import { ImageEditor } from './image-editor/ImageEditor'

function App() {

  return (
    <div className="container">
      <div className="row">
        <div className="col-lg-12">
          <ImageEditor />
        </div>
      </div>
    </div>
  )
}

export default App
