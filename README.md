# FilterTool

## Utilización

Crear el venv

    python -m venv venv

Para activar el venv en Windows desde la terminal del sistema operativo:

    venv\Scripts\activate.bat

Para activar el venv en Windows desde Git Bash

    . venv/Scripts/activate

Para activar el venv en Linux

    . venv/bin/activate

Instalar dependencias

En Windows se necesita:

    https://visualstudio.microsoft.com/visual-cpp-build-tools/

Descargar, ejecutar, elegir "Modify", "Desktop development with C++"

Luego:

    pip install -r requirements.txt

Correr el programa

    python main.py

## Consigna

### Inputs

- Mediante una función transferencia de orden arbitrario.
- Extraı́dos de una simulación de LTspice.
- Extraı́dos de un archivo CSV donde se almacenaron mediciones.

### Obligatorios

- Especificar la etiqueta de los ejes X e Y, como ası́ también poder agregar un tı́tulo de ser necesario.
- Guardar el resultado del gráfico como imagen.
- Borrar los gráficos sin necesidad de cerrar la herramienta.
- Al menos poder gráficar tres curvas a la vez. (∀x max : x max ≥ 3)
- Para diagramas de Bode, cambiar la escala del eje X e Y entre logarı́tmica y lineal.
- Representación de polos y ceros en el plano solo para cuando se escribe una transferencia de orden N.

### Opcionales

- “Togglear” cada curva (mostrar/ocultar)
- Cambiar los labels de las curvas.
- Cambiar el color de las mismas.
- En caso de hacer un estudio Montecarlo, poder aclarar la cantidad de runs que se quieran graficar y
- las variaciones máximas en cada componente.
- Cambiar el tamaño de la fuente de los labels y legends del gráfico.
- Cualquier otra cosa

## Features

El flujo de trabajo consiste en cargar ''datasets'', a partir de los cuales se pueden generar ''datalines'' personalizadas y permitiendo configurar los gráficos en los que aparece cada línea.

- Cargar más de un archivo como dataset, ya sea seleccionándolos en ''Import files'' o arrastrándolos directamente desde el explorador de archivos.
- Carga de una función transferencia a partir de su expresión matemática.
- Creación de todas las líneas necesarias a partir de un dataset.
- Cada línea puede aparecer en cualquiera de los 7 gráficos disponibles.
- Se pueden escalar los datos, por ejemplo, si se quiere poner los ejes en milisegundos en vez de segundos.
- Personalización del color, tipo, y grosor de línea, independiente para cada ''dataline'', junto con estilo de marcas y su tamaño.
- Detección automática del tipo de línea a generar (por defecto, funciones aparecen como líneas sólidas, y datos de CSV, spice, o txt de spice muestran únicamente puntos).
- Detección automática de casos al cargar un txt de simulación spice con parámetros variables.
- Detección automática del osciloscopio desde el que se generó el CSV en base al nombre del archivo o de la carpeta que lo contiene para facilitar generación de líneas. Incluyendo, al momento, el osciloscopio Rigol y los Agilent.
- Todos los cambios sobre el estilo del gráfico se ven reflejados en tiempo real.
- Acceso a la barra de herramientas de matplotlib, que permite configurar muchos elementos ya mencionados además de modificar las etiquetas de los ejes y sus límites.
- Personalizar la posición y tamaño de fuente de las leyendas en el gráfico.
- Aplicación de un filtro Savitzky-Golay de tamaño de ventana y orden personalizables por línea, adicionado principalmente para aminorar los artefactos provenientes de la discretización de los osciloscopios cuando fuera conveniente.
- Exportar a Latex si el usuario tiene una instalación compatible.
- Remoción de cualquier dataset o dataline cuando el usuario disponga.
- Función de autoescala que reinicia los límites y la escala del gráfico para cubrir toda la información disponible.
- Agregar N casos de una simulación de spice como líneas, con una configuración inicial general y paletas de colores especiales. Permite elegir si agregar los nombres de cada línea a la leyenda o no, por prolijidad.
- Constelación de polos y ceros para cada función transferencia adicionada.
